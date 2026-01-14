import express, { Request, Response } from 'express';
import cors from 'cors';
import * as fetch from 'node-fetch';
// Oppure se vuoi l'import predefinito:
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://netribe-samuele.github.io', 'http://localhost:3000']
}));
app.use(express.json());

// Endpoint per leggere un post con commenti
app.post('/api/read-post', async (req: Request, res: Response) => {
  try {
    const { pageAccessToken, postId } = req.body;
    
    if (!pageAccessToken || !postId) {
      return res.status(400).json({ 
        error: 'pageAccessToken e postId sono obbligatori' 
      });
    }

    // 1. Recupera il post
    const postResponse = await fetch(
      `https://graph.facebook.com/v19.0/${postId}?` +
      `fields=id,message,created_time,permalink_url&` +
      `access_token=${pageAccessToken}`
    );
    const post = await postResponse.json();

    // 2. Recupera i commenti
    const commentsResponse = await fetch(
      `https://graph.facebook.com/v19.0/${postId}/comments?` +
      `fields=id,message,created_time&` +
      `access_token=${pageAccessToken}&limit=50`
    );
    const commentsData = await commentsResponse.json();

    res.json({ 
      post, 
      comments: commentsData.data || [],
      totalComments: commentsData.data?.length || 0
    });
    
  } catch (error: any) {
    console.error('Errore:', error);
    res.status(500).json({ 
      error: error.message || 'Errore del server' 
    });
  }
});

// Endpoint di salute
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Meta Graph API Backend' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server backend in esecuzione su porta ${PORT}`);
});

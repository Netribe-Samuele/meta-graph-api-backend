import express, { Request, Response } from 'express';
import cors from 'cors';
import https from 'https';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['https://netribe-samuele.github.io', 'http://localhost:3000']
}));
app.use(express.json());

// Helper per chiamate Graph API
async function callGraphAPI(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error: unknown) {
          // Gestione corretta di error di tipo unknown
          const errorMessage = error instanceof Error 
            ? error.message 
            : 'Unknown parsing error';
          reject(new Error(`Failed to parse JSON: ${errorMessage}`));
        }
      });
    }).on('error', (error: Error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });
  });
}

// Endpoint 1: Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'Meta Graph API Backend',
    timestamp: new Date().toISOString()
  });
});

// Endpoint 2: Lista ID post
app.post('/api/list-post-ids', async (req: Request, res: Response) => {
  try {
    const { pageAccessToken, page, mode = 'published_posts', limit = 50 } = req.body;
    
    if (!pageAccessToken || !page) {
      return res.status(400).json({ 
        error: 'pageAccessToken e page sono obbligatori' 
      });
    }

    // Costruisci URL per Graph API
    const graphUrl = `https://graph.facebook.com/v19.0/${page}/${mode}?` +
      `fields=id&` +
      `access_token=${pageAccessToken}&` +
      `limit=${limit}`;
    
    const result = await callGraphAPI(graphUrl);
    
    if (result.error) {
      return res.status(400).json({ 
        error: `Facebook API error: ${result.error.message}` 
      });
    }
    
    res.json({ 
      ids: result.data?.map((post: any) => post.id) || [],
      total: result.data?.length || 0,
      paging: result.paging || {}
    });
    
  } catch (error: unknown) {
    console.error('Errore in /api/list-post-ids:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Errore del server';
    res.status(500).json({ 
      error: errorMessage 
    });
  }
});

// Endpoint 3: Post con commenti (limitato)
app.post('/api/posts-with-comments', async (req: Request, res: Response) => {
  try {
    const { pageAccessToken, page, postLimit = 5, commentLimit = 10 } = req.body;
    
    if (!pageAccessToken || !page) {
      return res.status(400).json({ 
        error: 'pageAccessToken e page sono obbligatori' 
      });
    }

    // 1. Ottieni i post
    const postsUrl = `https://graph.facebook.com/v19.0/${page}/published_posts?` +
      `fields=id,message,created_time,permalink_url&` +
      `access_token=${pageAccessToken}&` +
      `limit=${postLimit}`;
    
    const postsResult = await callGraphAPI(postsUrl);
    
    if (postsResult.error) {
      return res.status(400).json({ 
        error: `Facebook API error: ${postsResult.error.message}` 
      });
    }
    
    const posts = postsResult.data || [];
    
    // 2. Per ogni post, ottieni i commenti (parallelismo limitato)
    const postsWithComments = [];
    for (const post of posts.slice(0, 3)) {
      try {
        const commentsUrl = `https://graph.facebook.com/v19.0/${post.id}/comments?` +
          `fields=id,message,created_time&` +
          `access_token=${pageAccessToken}&` +
          `limit=${commentLimit}`;
        
        const commentsResult = await callGraphAPI(commentsUrl);
        
        postsWithComments.push({
          ...post,
          comments: commentsResult.data || [],
          totalComments: commentsResult.data?.length || 0
        });
      } catch (commentError: unknown) {
        const errorMsg = commentError instanceof Error 
          ? commentError.message 
          : 'Unknown error';
        postsWithComments.push({
          ...post,
          comments: [],
          totalComments: 0,
          commentError: errorMsg
        });
      }
    }
    
    res.json({ 
      totalPosts: posts.length,
      postsWithComments,
      fetchedCommentsFor: Math.min(3, posts.length)
    });
    
  } catch (error: unknown) {
    console.error('Errore in /api/posts-with-comments:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Errore del server';
    res.status(500).json({ 
      error: errorMessage 
    });
  }
});

// Endpoint 4: Leggi un post specifico
app.post('/api/read-post', async (req: Request, res: Response) => {
  try {
    const { pageAccessToken, postId } = req.body;
    
    if (!pageAccessToken || !postId) {
      return res.status(400).json({ 
        error: 'pageAccessToken e postId sono obbligatori' 
      });
    }

    // 1. Ottieni il post
    const postUrl = `https://graph.facebook.com/v19.0/${postId}?` +
      `fields=id,message,created_time,permalink_url&` +
      `access_token=${pageAccessToken}`;
    
    const postResult = await callGraphAPI(postUrl);
    
    if (postResult.error) {
      return res.status(400).json({ 
        error: `Facebook API error: ${postResult.error.message}` 
      });
    }
    
    // 2. Ottieni i commenti (con paginazione)
    let allComments: any[] = [];
    let nextUrl = `https://graph.facebook.com/v19.0/${postId}/comments?` +
      `fields=id,message,created_time&` +
      `access_token=${pageAccessToken}&` +
      `limit=100`;
    
    try {
      while (nextUrl && allComments.length < 500) {
        const commentsResult = await callGraphAPI(nextUrl);
        allComments = [...allComments, ...(commentsResult.data || [])];
        
        nextUrl = commentsResult.paging?.next || null;
      }
    } catch (commentError: unknown) {
      console.warn('Errore nel recupero commenti:', commentError);
      // Continua comunque con i commenti già recuperati
    }
    
    res.json({ 
      post: postResult,
      comments: allComments,
      totalComments: allComments.length
    });
    
  } catch (error: unknown) {
    console.error('Errore in /api/read-post:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Errore del server';
    res.status(500).json({ 
      error: errorMessage 
    });
  }
});

// Avvio server
app.listen(PORT, () => {
  console.log(`🚀 Server backend in esecuzione su porta ${PORT}`);
  console.log(`✅ Endpoints disponibili:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/list-post-ids`);
  console.log(`   POST /api/posts-with-comments`);
  console.log(`   POST /api/read-post`);
});

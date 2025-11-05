import { getCollection } from 'astro:content';

export async function GET() {
  const posts = await getCollection('blog');

  const searchData = posts.map((post) => ({
    id: post.id,
    data: {
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      tags: post.data.tags || [],
      categories: post.data.categories || [],
    },
  }));

  return new Response(JSON.stringify(searchData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

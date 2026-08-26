export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // 代理所有請求到後端 elsa.pin-yi.uk
    const url = new URL(request.url);
    const targetUrl = `https://elsa.pin-yi.uk${url.pathname}${url.search}`;
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const response = await fetch(newRequest);
    // 跨域允許（若需要）
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;
  }
};

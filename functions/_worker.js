export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const targetUrl = `https://elsa.pin-yi.uk${url.pathname}${url.search}`;
  const newRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const response = await fetch(newRequest);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  return newResponse;
}

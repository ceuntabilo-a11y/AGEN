const ORIGIN = "https://agen-prod-web.8kpnr1.easypanel.host";

const worker = {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);

    headers.delete("host");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const response = await fetch(target, init);
    const responseHeaders = new Headers(response.headers);
    const location = responseHeaders.get("location");

    if (location) {
      const redirectUrl = new URL(location, target);

      if (redirectUrl.hostname === new URL(ORIGIN).hostname) {
        redirectUrl.protocol = incoming.protocol;
        redirectUrl.host = incoming.host;
        responseHeaders.set("location", redirectUrl.toString());
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};

export default worker;

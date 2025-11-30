export default async function handler(req: any, res: any) {
  try {
    const backendUrl = "http://172.236.110.221:5000/api/upload";

    const response = await fetch(backendUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined,
      },
      body: req.body,
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Could not reach backend" });
  }
}

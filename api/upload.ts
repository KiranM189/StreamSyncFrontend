export default async function handler(req: any, res: any) {
  try {
    const backendUrl = "http://172.236.110.221:5000/api/upload";

    const response = await fetch(backendUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined
      },
      body: req.body
    });

    const body = await response.text();
    res.status(response.status).send(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Backend unreachable" });
  }
}

export async function post(url: string, data: any) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });

    const text = await response.text();
    if (!text) return {}; // Handle empty response

    const res = JSON.parse(text);
    if (res.code !== 0 && res.code !== undefined) throw new Error(`API Error ${res.code}: ${res.msg}`);
    return res.data || res;
}

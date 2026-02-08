export async function post(url: string, data: any) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    const res = await response.json();
    if (res.code !== 0) throw new Error(`API Error ${res.code}: ${res.msg}`);
    return res.data;
}

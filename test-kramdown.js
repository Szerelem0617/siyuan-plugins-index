import http from 'http';

const items = [
    "20260212220520-9fuafc0", // Parent 1
    "20260303120152-zv4cicy", // Child
    "20260212201942-ndbc993"  // Parent 2
];

function fetchKramdown(id) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ id: id });
        const req = http.request({
            hostname: '127.0.0.1',
            port: 6806,
            path: '/api/block/getBlockKramdown',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body).data.kramdown);
                } catch (e) {
                    resolve("Error parsing: " + body);
                }
            });
        });
        req.write(data);
        req.end();
    });
}

async function run() {
    for (let id of items) {
        console.log(`\n--- Kramdown for ${id} ---`);
        let res = await fetchKramdown(id);
        console.log(JSON.stringify(res));
    }
}
run();

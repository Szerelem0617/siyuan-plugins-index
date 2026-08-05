export async function triggerFireworks(
    _params: Record<string, unknown>,
    context: { blockEl: HTMLElement; protyleEl: HTMLElement | null; triggerEl?: HTMLElement }
) {
    // 1. Get position
    let startX = window.innerWidth / 2;
    let startY = window.innerHeight / 2;

    const el = context.triggerEl || context.blockEl;
    if (el) {
        const rect = el.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
    }

    console.log("[IndexOS-Fireworks] Starting fireworks animation.", {
        startX,
        startY,
        hasTriggerEl: !!context.triggerEl,
        hasBlockEl: !!context.blockEl
    });

    // 2. Create canvas
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "99999";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    
    // 3. Resize handling
    const handleResize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // 4. Particle structure
    interface Particle {
        x: number;
        y: number;
        vx: number;
        vy: number;
        alpha: number;
        decay: number;
        color: string;
        size: number;
    }

    const particles: Particle[] = [];
    const colors = [
        "hsl(0, 100%, 65%)",    // Red
        "hsl(30, 100%, 65%)",   // Orange
        "hsl(60, 100%, 65%)",   // Yellow
        "hsl(120, 100%, 65%)",  // Green
        "hsl(180, 100%, 65%)",  // Cyan
        "hsl(240, 100%, 65%)",  // Blue
        "hsl(280, 100%, 65%)",  // Purple
        "hsl(330, 100%, 65%)"   // Pink
    ];

    // Spawn 80 particles
    const particleCount = 80;
    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 6; // Random speed
        particles.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1.0,
            decay: 0.01 + Math.random() * 0.015, // decay speed
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 2.5 + Math.random() * 2.5
        });
    }

    // 5. Animation loop
    const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        let alive = false;
        for (const p of particles) {
            if (p.alpha > 0) {
                alive = true;
                
                // Physics: apply friction and gravity
                p.vx *= 0.98;
                p.vy *= 0.98;
                p.vy += 0.15; // Gravity
                
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= p.decay;
                
                if (p.alpha > 0) {
                    ctx.save();
                    ctx.globalAlpha = p.alpha;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = p.color;
                    ctx.fill();
                    ctx.restore();
                }
            }
        }

        if (alive) {
            requestAnimationFrame(animate);
        } else {
            // Clean up
            window.removeEventListener("resize", handleResize);
            canvas.remove();
        }
    };

    animate();
}

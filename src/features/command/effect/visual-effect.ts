/**
 * effect/visual-effect.ts
 *
 * 现代高质感视觉特效引擎（Canvas 2D / 60FPS 物理动力学）：
 * 1. fireworks: 🎆 庆贺烟花（360° 重力全向爆炸，用于任务完成 / Milestone 庆贺）
 * 2. meteor:    🌌 流星跃迁（45° 银白/冰蓝长拖尾流星群 + 宇宙星尘，用于灵感捕获 / 思想闪光）
 * 3. neon_scan: 💫 霓虹扫描（极细青紫激光沿块矩形边框瞬间疾驰环绕 + 尾迹辉光，用于 Pipeline 自动化成功）
 * 4. bubble:    🫧 琉璃气泡（带彩虹折射与双光斑的通透浮空气泡 + 微物理晃动，用于随笔日记 / 碎片想法）
 * 5. breeze:    🍃 禅意流风（翡翠绿叶优雅抛物线波浪摇曳与 3D 翻转，用于笔记归档 / 番茄钟收工）
 */

import type { CommandContext } from "../dispatcher";

export async function triggerVisualEffect(
    params: { type?: string },
    context: CommandContext
) {
    const effectType = String(params?.type || "fireworks").toLowerCase().trim();

    // 1. 直接读取调度器预计算的标准空间几何对象 (0 样板代码)
    const geo = context.geometry || {
        x: Math.round(window.innerWidth / 2 - 80),
        y: Math.round(window.innerHeight / 2 - 20),
        width: 160,
        height: 40,
        centerX: Math.round(window.innerWidth / 2),
        centerY: Math.round(window.innerHeight / 2)
    };

    const startX = geo.centerX;
    const startY = geo.centerY;
    const rectLeft = geo.x;
    const rectTop = geo.y;
    const targetWidth = geo.width;
    const targetHeight = geo.height;

    // 2. 创建高层级全屏透明 Canvas
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
    
    const handleResize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // =========================================================================
    // 模式 1: 🌌 流星跃迁 (Meteor / Shooting Stars with Stardust)
    // =========================================================================
    if (effectType === "meteor" || effectType === "shooting_star") {
        interface Meteor {
            x: number;
            y: number;
            startX: number;
            startY: number;
            length: number;
            speed: number;
            angle: number;
            thickness: number;
            alpha: number;
            decay: number;
            delay: number; // 错落发射延迟（帧数）
            colorHead: string;
            colorTail: string;
        }

        interface Stardust {
            x: number;
            y: number;
            size: number;
            alpha: number;
            decay: number;
            color: string;
        }

        const meteors: Meteor[] = [];
        const dustList: Stardust[] = [];

        // 生成 5 道具有自然角度散布与时序错落的流星
        const meteorCount = 5;
        // 基础角度约 135° (3/4 PI)，各流星在 120° ~ 150° 之间自然发散
        const angles = [
            Math.PI * 0.72, // ~130°
            Math.PI * 0.78, // ~140°
            Math.PI * 0.68, // ~122°
            Math.PI * 0.82, // ~148°
            Math.PI * 0.75  // ~135°
        ];

        // 不同的起始散布点，避免全在同一条直线上
        const spawnOffsets = [
            { dx: 60, dy: -120, delay: 0 },
            { dx: 140, dy: -90, delay: 6 },
            { dx: -20, dy: -150, delay: 14 },
            { dx: 180, dy: -160, delay: 20 },
            { dx: 90, dy: -200, delay: 28 }
        ];

        for (let i = 0; i < meteorCount; i++) {
            const offset = spawnOffsets[i];
            const baseAngle = angles[i] + (Math.random() - 0.5) * 0.06;
            const initX = startX + offset.dx + (Math.random() - 0.5) * 40;
            const initY = startY + offset.dy + (Math.random() - 0.5) * 30;

            meteors.push({
                x: initX,
                y: initY,
                startX: initX,
                startY: initY,
                length: 100 + Math.random() * 70,
                speed: 7.5 + Math.random() * 3.5, // 速度适中舒适 (原先 14~20 太快)
                angle: baseAngle,
                thickness: 2.0 + Math.random() * 1.5,
                alpha: 1.0,
                decay: 0.012 + Math.random() * 0.008, // 柔和衰减
                delay: offset.delay,
                colorHead: i % 2 === 0 ? "#FFFFFF" : "#E3FAFC",
                colorTail: i % 2 === 0 ? "rgba(92, 124, 250, 0)" : "rgba(34, 184, 207, 0)"
            });
        }

        const animateMeteor = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            // 1. 绘制星尘微光粒子
            for (const d of dustList) {
                if (d.alpha > 0) {
                    alive = true;
                    d.alpha -= d.decay;
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, d.alpha);
                    ctx.beginPath();
                    ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
                    ctx.fillStyle = d.color;
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = d.color;
                    ctx.fill();
                    ctx.restore();
                }
            }

            // 2. 绘制各道错落发散流星本体与渐变长拖尾
            for (const m of meteors) {
                if (m.delay > 0) {
                    m.delay--;
                    alive = true;
                    continue;
                }

                if (m.alpha > 0) {
                    alive = true;
                    const vx = Math.cos(m.angle) * m.speed;
                    const vy = Math.sin(m.angle) * m.speed;
                    m.x += vx;
                    m.y += vy;
                    m.alpha -= m.decay;

                    const tailX = m.x - Math.cos(m.angle) * m.length;
                    const tailY = m.y - Math.sin(m.angle) * m.length;

                    // 沿途持续抛洒星尘微粒
                    if (Math.random() > 0.35 && m.alpha > 0.15) {
                        dustList.push({
                            x: m.x + (Math.random() - 0.5) * 8,
                            y: m.y + (Math.random() - 0.5) * 8,
                            size: 1.2 + Math.random() * 2.2,
                            alpha: m.alpha * 0.85,
                            decay: 0.02 + Math.random() * 0.02,
                            color: "#A5D8FF"
                        });
                    }

                    ctx.save();
                    ctx.globalAlpha = Math.max(0, m.alpha);

                    const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
                    grad.addColorStop(0, m.colorHead);
                    grad.addColorStop(0.25, "rgba(116, 192, 252, 0.85)");
                    grad.addColorStop(0.65, "rgba(74, 144, 226, 0.45)");
                    grad.addColorStop(1, m.colorTail);

                    ctx.beginPath();
                    ctx.moveTo(m.x, m.y);
                    ctx.lineTo(tailX, tailY);
                    ctx.strokeStyle = grad;
                    ctx.lineWidth = m.thickness;
                    ctx.lineCap = "round";
                    ctx.shadowBlur = 12;
                    ctx.shadowColor = "#4DABF7";
                    ctx.stroke();

                    // 流星头部耀眼光核与光晕
                    ctx.beginPath();
                    ctx.arc(m.x, m.y, m.thickness * 1.3, 0, Math.PI * 2);
                    ctx.fillStyle = "#FFFFFF";
                    ctx.shadowBlur = 16;
                    ctx.shadowColor = "#FFFFFF";
                    ctx.fill();

                    ctx.restore();
                }
            }

            if (alive) {
                requestAnimationFrame(animateMeteor);
            } else {
                window.removeEventListener("resize", handleResize);
                canvas.remove();
            }
        };

        animateMeteor();
        return { success: true, method: "custom", detail: "Visual effect [meteor] played." };
    }

    // =========================================================================
    // 模式 2: 💫 霓虹扫描 (Neon Border Scan Wipe)
    // =========================================================================
    if (effectType === "neon_scan" || effectType === "neon" || effectType === "scan") {
        const padding = 4;
        const x = rectLeft - padding;
        const y = rectTop - padding;
        const w = targetWidth + padding * 2;
        const h = targetHeight + padding * 2;
        const r = 6; // 圆角半径

        const perimeter = (w + h) * 2;
        let progress = 0; // 0 -> 1
        const speed = 0.032;
        let alpha = 1.0;

        const animateNeon = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            progress += speed;

            if (progress <= 1.25) {
                const currentLen = progress * perimeter;
                const headLen = Math.min(currentLen, perimeter);
                const tailLen = Math.max(0, currentLen - perimeter * 0.4);

                ctx.save();
                if (progress > 0.85) {
                    alpha = Math.max(0, (1.25 - progress) / 0.4);
                }
                ctx.globalAlpha = alpha;

                // 绘制圆角矩形路径
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, r);
                
                ctx.strokeStyle = "#4DABF7";
                ctx.lineWidth = 2.5;
                ctx.shadowBlur = 12;
                ctx.shadowColor = "#339AF0";
                ctx.setLineDash([perimeter * 0.35, perimeter]);
                ctx.lineDashOffset = -tailLen;
                ctx.stroke();

                // 亮白流光头部光斑
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 3.5;
                ctx.shadowBlur = 16;
                ctx.shadowColor = "#FFFFFF";
                ctx.setLineDash([16, perimeter]);
                ctx.lineDashOffset = -headLen;
                ctx.stroke();

                ctx.restore();

                requestAnimationFrame(animateNeon);
            } else {
                window.removeEventListener("resize", handleResize);
                canvas.remove();
            }
        };

        animateNeon();
        return { success: true, method: "custom", detail: "Visual effect [neon_scan] played." };
    }

    // =========================================================================
    // 模式 3: 🫧 琉璃微气泡 (Iridescent Floating Bubbles)
    // =========================================================================
    if (effectType === "bubble" || effectType === "bubbles") {
        interface Bubble {
            x: number;
            y: number;
            vx: number;
            vy: number;
            radius: number;
            wobbleOffset: number;
            wobbleSpeed: number;
            alpha: number;
            decay: number;
            hue: number;
        }

        const bubbles: Bubble[] = [];
        const bubbleCount = 20;

        for (let i = 0; i < bubbleCount; i++) {
            bubbles.push({
                x: rectLeft + Math.random() * targetWidth,
                y: rectTop + targetHeight + Math.random() * 15,
                vx: (Math.random() - 0.5) * 0.6,
                vy: -(1.5 + Math.random() * 2.2), // 向上轻盈浮升
                radius: 6 + Math.random() * 11,
                wobbleOffset: Math.random() * Math.PI * 2,
                wobbleSpeed: 0.04 + Math.random() * 0.04,
                alpha: 0.85,
                decay: 0.008 + Math.random() * 0.007,
                hue: 180 + Math.random() * 90 // 青色至天蓝彩虹折射
            });
        }

        const drawGlassBubble = (b: Bubble) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, b.alpha);

            // 1. 气泡彩虹外晕与薄膜渐变
            const grad = ctx.createRadialGradient(
                b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.1,
                b.x, b.y, b.radius
            );
            grad.addColorStop(0, "rgba(255, 255, 255, 0.2)");
            grad.addColorStop(0.7, `hsla(${b.hue}, 90%, 75%, 0.15)`);
            grad.addColorStop(1, `hsla(${b.hue + 40}, 95%, 65%, 0.65)`);

            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            // 2. 气泡细边缘
            ctx.strokeStyle = `hsla(${b.hue}, 100%, 85%, 0.8)`;
            ctx.lineWidth = 1;
            ctx.stroke();

            // 3. 晶莹高光反光点 (Highlight)
            ctx.beginPath();
            ctx.ellipse(
                b.x - b.radius * 0.38,
                b.y - b.radius * 0.38,
                b.radius * 0.3,
                b.radius * 0.18,
                -Math.PI / 4,
                0,
                Math.PI * 2
            );
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fill();

            ctx.restore();
        };

        const animateBubble = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            for (const b of bubbles) {
                if (b.alpha > 0) {
                    alive = true;
                    b.wobbleOffset += b.wobbleSpeed;
                    b.x += b.vx + Math.sin(b.wobbleOffset) * 0.6;
                    b.y += b.vy;
                    b.alpha -= b.decay;

                    if (b.alpha > 0) {
                        drawGlassBubble(b);
                    }
                }
            }

            if (alive) {
                requestAnimationFrame(animateBubble);
            } else {
                window.removeEventListener("resize", handleResize);
                canvas.remove();
            }
        };

        animateBubble();
        return { success: true, method: "custom", detail: "Visual effect [bubble] played." };
    }

    // =========================================================================
    // 模式 4: 🍃 禅意流风 (Breeze / Emerald Leaf Floating)
    // =========================================================================
    if (effectType === "breeze") {
        interface LeafParticle {
            x: number;
            y: number;
            vx: number;
            vy: number;
            swaySpeed: number;
            swayOffset: number;
            rotation: number;
            rotationSpeed: number;
            scaleX: number;
            size: number;
            alpha: number;
            decay: number;
            color: string;
        }

        const leaves: LeafParticle[] = [];
        const leafColors = ["#51CF66", "#40C057", "#2F9E44", "#37B24D", "#69DB7C", "#8CE99A", "#96F2D7"];
        const count = 28;
        const originLeft = startX - targetWidth / 2 - 20;

        for (let i = 0; i < count; i++) {
            leaves.push({
                x: originLeft + Math.random() * (targetWidth + 40),
                y: startY + (Math.random() - 0.5) * targetHeight,
                vx: 2.2 + Math.random() * 3.5,
                vy: (Math.random() - 0.5) * 1.5 - 0.5,
                swaySpeed: 0.03 + Math.random() * 0.04,
                swayOffset: Math.random() * Math.PI * 2,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.06,
                scaleX: 1,
                size: 7 + Math.random() * 6,
                alpha: 1.0,
                decay: 0.008 + Math.random() * 0.008,
                color: leafColors[Math.floor(Math.random() * leafColors.length)]
            });
        }

        const drawLeaf = (leaf: LeafParticle) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, leaf.alpha);
            ctx.translate(leaf.x, leaf.y);
            ctx.rotate(leaf.rotation);
            ctx.scale(leaf.scaleX, 1);

            ctx.beginPath();
            ctx.moveTo(-leaf.size, 0);
            ctx.quadraticCurveTo(0, -leaf.size * 0.65, leaf.size, 0);
            ctx.quadraticCurveTo(0, leaf.size * 0.65, -leaf.size, 0);
            ctx.fillStyle = leaf.color;
            ctx.shadowBlur = 4;
            ctx.shadowColor = "rgba(64, 192, 87, 0.4)";
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-leaf.size * 0.7, 0);
            ctx.lineTo(leaf.size * 0.7, 0);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.restore();
        };

        const animateBreeze = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            for (const leaf of leaves) {
                if (leaf.alpha > 0) {
                    alive = true;
                    leaf.swayOffset += leaf.swaySpeed;
                    leaf.x += leaf.vx;
                    leaf.y += leaf.vy + Math.sin(leaf.swayOffset) * 0.8;
                    leaf.rotation += leaf.rotationSpeed;
                    leaf.scaleX = Math.cos(leaf.swayOffset);
                    leaf.alpha -= leaf.decay;

                    if (leaf.alpha > 0) {
                        drawLeaf(leaf);
                    }
                }
            }

            if (alive) {
                requestAnimationFrame(animateBreeze);
            } else {
                window.removeEventListener("resize", handleResize);
                canvas.remove();
            }
        };

        animateBreeze();
        return { success: true, method: "custom", detail: "Visual effect [breeze] played." };
    }

    // =========================================================================
    // 模式 5: 🎆 庆贺烟花 (Fireworks, 默认)
    // =========================================================================
    interface FireworkParticle {
        x: number;
        y: number;
        vx: number;
        vy: number;
        alpha: number;
        decay: number;
        color: string;
        size: number;
    }

    const particles: FireworkParticle[] = [];
    const colors = [
        "hsl(0, 100%, 65%)", "hsl(30, 100%, 65%)", "hsl(50, 100%, 65%)",
        "hsl(120, 100%, 65%)", "hsl(180, 100%, 65%)", "hsl(240, 100%, 65%)",
        "hsl(280, 100%, 65%)", "hsl(330, 100%, 65%)"
    ];

    const particleCount = 80;
    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 6;
        particles.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1.0,
            decay: 0.01 + Math.random() * 0.015,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 2.5 + Math.random() * 2.5
        });
    }

    const animateFireworks = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;

        for (const p of particles) {
            if (p.alpha > 0) {
                alive = true;
                p.vx *= 0.98;
                p.vy *= 0.98;
                p.vy += 0.15; // 重力下坠
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= p.decay;

                if (p.alpha > 0) {
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, p.alpha);
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
            requestAnimationFrame(animateFireworks);
        } else {
            window.removeEventListener("resize", handleResize);
            canvas.remove();
        }
    };

    animateFireworks();
    return { success: true, method: "custom", detail: "Visual effect [fireworks] played." };
}

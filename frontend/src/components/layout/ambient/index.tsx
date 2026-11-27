import React, { useEffect, useRef } from 'react';

import styles from './index.module.css';

/** Tri-color neon particles rising through the shell background. */
const PARTICLE_COLORS = ['#7dd6ff', '#b58cff', '#ff7bcb'] as const;
const PARTICLE_COUNT = 65;

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    color: string;
    alpha: number;
    life: number;
    maxLife: number;
};

const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const makeParticle = (width: number, height: number): Particle => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: -(Math.random() * 0.55 + 0.15),
    r: Math.random() * 1.6 + 0.4,
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    alpha: Math.random() * 0.55 + 0.12,
    life: Math.random(),
    maxLife: Math.random() * 0.75 + 0.45,
});

/**
 * Ambient background for the app shell: a particle canvas plus a faint grid
 * overlay (pure CSS). Purely decorative and
 * pointer-events:none, so it never intercepts interaction. Honors
 * prefers-reduced-motion by rendering a single static frame instead of looping.
 */
const Ambient: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let particles: Particle[] = [];

        const reduced = prefersReducedMotion();

        const resize = () => {
            const w = canvas.offsetWidth || window.innerWidth;
            const h = canvas.offsetHeight || window.innerHeight;
            canvas.width = w;
            canvas.height = h;
            particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(w, h));
            // Setting canvas.width clears it; the animation loop repaints on its own,
            // but the static (reduced-motion) frame must be redrawn here.
            if (reduced) draw(false);
        };

        const draw = (advance: boolean) => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const p of particles) {
                if (advance) {
                    p.life -= 0.0025;
                    if (p.life <= 0) {
                        p.x = Math.random() * canvas.width;
                        p.y = canvas.height + 5;
                        p.life = p.maxLife;
                        p.alpha = Math.random() * 0.55 + 0.12;
                    }
                    p.x += p.vx;
                    p.y += p.vy;
                }
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.alpha * (p.life / p.maxLife);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        };

        resize();

        if (reduced) {
            // resize() painted the static frame and repaints it on every resize.
            window.addEventListener('resize', resize);
            return () => window.removeEventListener('resize', resize);
        }

        let raf = 0;
        const tick = () => {
            draw(true);
            raf = requestAnimationFrame(tick);
        };
        tick();
        window.addEventListener('resize', resize);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return (
        <div className={styles.ambient} aria-hidden="true">
            <canvas ref={canvasRef} className={styles.canvas} />
        </div>
    );
};

export default Ambient;

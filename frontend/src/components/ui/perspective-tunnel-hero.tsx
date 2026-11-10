"use client";

import {
    motion,
    useTransform,
    useReducedMotion,
    useMotionValue,
    useSpring,
    MotionValue,
} from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Served from public/ because the app's Content-Security-Policy only allows same-origin images.
const IMAGES = [
    { src: "/images/tunnel/1.jpg", title: "Study group" },
    { src: "/images/tunnel/2.jpg", title: "Team project" },
    { src: "/images/tunnel/3.jpg", title: "Discussion" },
    { src: "/images/tunnel/4.jpg", title: "Deep focus" },
    { src: "/images/tunnel/5.jpg", title: "Annotated notes" },
    { src: "/images/tunnel/6.jpg", title: "First lessons" },
    { src: "/images/tunnel/7.jpg", title: "Writing" },
    { src: "/images/tunnel/8.jpg", title: "The library" },
    { src: "/images/tunnel/9.jpg", title: "The stacks" },
];


interface TunnelCardData {
    item: { src: string; title: string };
    angleCos: number;
    angleSin: number;
    radiusFactorX: number;
    radiusFactorY: number;
    rotationZ: number;
    index: number;
}

const TUNNEL_CARDS: TunnelCardData[] = IMAGES.map((item, i) => {
    const goldenAngle = i * 137.5 * (Math.PI / 180);
    const radiusFactorX = 0.28 + (i % 3) * 0.08;
    const radiusFactorY = 0.26 + (i % 2) * 0.09;

    return {
        item,
        angleCos: Math.cos(goldenAngle),
        angleSin: Math.sin(goldenAngle),
        radiusFactorX,
        radiusFactorY,
        rotationZ: (i % 2 === 0 ? 1 : -1) * (3 + (i % 5) * 2),
        index: i,
    };
});

const SPRING_CONFIG = { stiffness: 60, damping: 25, mass: 0.5 };

const WHEEL_SPEED = 0.0012;
const TOUCH_SPEED = 0.0025;
const KEY_STEPS: Record<string, number> = { ArrowDown: 0.08, ArrowUp: -0.08, PageDown: 0.3, PageUp: -0.3 };
const SPACE_STEP = 0.3;

interface StageDimensions {
    width: number;
    height: number;
    isMobile: boolean;
}

function useCameraParallax(enabled: boolean) {
    const rawX = useMotionValue(0);
    const rawY = useMotionValue(0);
    const x = useSpring(rawX, SPRING_CONFIG);
    const y = useSpring(rawY, SPRING_CONFIG);

    useEffect(() => {
        if (!enabled) return;
        const onMove = (e: PointerEvent) => {
            rawX.set((e.clientX / window.innerWidth - 0.5) * 2);
            rawY.set((e.clientY / window.innerHeight - 0.5) * 2);
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => window.removeEventListener("pointermove", onMove);
    }, [enabled, rawX, rawY]);

    return { x, y };
}

interface TunnelCardProps {
    card: TunnelCardData;
    progress: MotionValue<number>;
    pointer: { x: MotionValue<number>; y: MotionValue<number> };
    total: number;
    stage: StageDimensions;
}

function TunnelCard({ card, progress, pointer, total, stage }: TunnelCardProps) {
    const staggerSpan = 0.55;
    const start = (card.index / total) * (1 - staggerSpan);
    const end = start + staggerSpan;

    const localProgress = useTransform(progress, [start, end], [0, 1]);

    const farZ = stage.isMobile ? -1200 : -1700;
    const nearZ = stage.isMobile ? 350 : 500;
    const z = useTransform(localProgress, [0, 1], [farZ, nearZ]);

    const opacity = useTransform(localProgress, [0, 0.18, 0.82, 0.98], [0, 1, 1, 0]);

    const cardWidth = stage.isMobile
        ? Math.max(130, Math.min(180, stage.width * 0.38))
        : Math.max(180, Math.min(270, stage.width * 0.18));

    const baseX = card.angleCos * (stage.width * card.radiusFactorX);
    const baseY = card.angleSin * (stage.height * card.radiusFactorY);
    const panStrength = stage.isMobile ? 20 : 45;

    const transform = useTransform(
        [z, pointer.x, pointer.y],
        ([currZ, px, py]: number[]) => {
            const offsetX = baseX - px * panStrength;
            const offsetY = baseY - py * panStrength;
            return `translate3d(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px), ${currZ}px) rotateZ(${card.rotationZ}deg)`;
        }
    );

    return (
        <motion.div
            style={{
                width: cardWidth,
                transform,
                opacity,
                zIndex: card.index + 1,
            }}
            className="pointer-events-auto absolute left-1/2 top-1/2 aspect-[4/5] will-change-transform select-none"
        >
            <div className="group relative h-full w-full overflow-hidden rounded-2xl bg-neutral-200 shadow-2xl shadow-neutral-950/20 ring-1 ring-black/10 transition-all duration-500 hover:ring-[var(--brand)]/70">
                <img
                    src={card.item.src}
                    alt=""
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent flex items-end p-4 sm:p-5">
                    <span className="text-xs sm:text-sm font-medium tracking-wide text-white/95 drop-shadow-md">
                        {card.item.title}
                    </span>
                </div>
            </div>
        </motion.div>
    );
}

interface PerspectiveTunnelHeroProps {
    title: ReactNode;
    description?: ReactNode;
    /** Stays above the flying cards, so it can always be seen and clicked. */
    actions?: ReactNode;
}

export default function PerspectiveTunnelHero({ title, description, actions }: PerspectiveTunnelHeroProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const reduce = useReducedMotion();

    const [stage, setStage] = useState<StageDimensions>({
        width: 1440,
        height: 900,
        isMobile: false,
    });

    useEffect(() => {
        const updateDimensions = () => {
            setStage({
                width: window.innerWidth,
                height: window.innerHeight,
                isMobile: window.innerWidth < 768,
            });
        };

        updateDimensions();
        window.addEventListener("resize", updateDimensions);
        return () => window.removeEventListener("resize", updateDimensions);
    }, []);

    // Raw motion value controlled directly by wheel, touch and keyboard
    const rawProgress = useMotionValue(0);
    const smoothProgress = useSpring(rawProgress, {
        stiffness: 80,
        damping: 30,
        restDelta: 0.0001,
    });

    // The tunnel only takes input while the page is at the top and there is still
    // somewhere to travel. Otherwise the event is left alone and the page scrolls.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || reduce) return;

        const advance = (delta: number) => {
            if (window.scrollY > 1) return false;
            const current = rawProgress.get();
            const next = Math.min(1, Math.max(0, current + delta));
            if (next === current) return false;
            rawProgress.set(next);
            return true;
        };

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) return; // pinch and browser zoom
            if (advance(e.deltaY * WHEEL_SPEED)) e.preventDefault();
        };

        let lastY: number | null = null;
        const handleTouchStart = (e: TouchEvent) => {
            lastY = e.touches.length === 1 ? e.touches[0].clientY : null;
        };
        const handleTouchMove = (e: TouchEvent) => {
            if (lastY === null || e.touches.length !== 1) return;
            const y = e.touches[0].clientY;
            const moved = lastY - y;
            lastY = y;
            if (advance(moved * TOUCH_SPEED) && e.cancelable) e.preventDefault();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof Element)) return;
            const isSpace = e.key === " ";
            const ignore = isSpace
                ? "a, button, input, select, textarea, summary, [contenteditable]"
                : "input, select, textarea, [contenteditable]";
            if (e.target.closest(ignore)) return;
            const step = isSpace ? (e.shiftKey ? -SPACE_STEP : SPACE_STEP) : KEY_STEPS[e.key];
            if (step && advance(step)) e.preventDefault();
        };

        el.addEventListener("wheel", handleWheel, { passive: false });
        el.addEventListener("touchstart", handleTouchStart, { passive: true });
        el.addEventListener("touchmove", handleTouchMove, { passive: false });
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            el.removeEventListener("wheel", handleWheel);
            el.removeEventListener("touchstart", handleTouchStart);
            el.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [rawProgress, reduce]);

    const pointer = useCameraParallax(!reduce);

    const titleScale = useTransform(smoothProgress, [0, 0.5, 1], [1, 1.06, 1]);
    const promptOpacity = useTransform(smoothProgress, [0, 0.12], [1, 0]);

    return (
        <div
            ref={containerRef}
            className="relative h-[calc(100svh-var(--topbar))] min-h-[32rem] w-full overflow-hidden bg-[var(--bg)] text-[var(--text)] flex items-center justify-center"
            style={{
                perspective: stage.isMobile ? "900px" : "1200px",
                transformStyle: "preserve-3d",
            }}
        >
            {/* Immersive Background Grid & Glow */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,#000_60%,transparent_100%)] opacity-70" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.12)_0%,transparent_70%)]" />

            {/* Depth Ring Guides */}
            <div className="pointer-events-none absolute h-[48vmin] w-[48vmin] rounded-full border border-[var(--brand)]/15" />
            <div className="pointer-events-none absolute h-[76vmin] w-[76vmin] rounded-full border border-dashed border-neutral-300/60" />

            {/* Central Anchor Typography */}
            <motion.div
                style={{ scale: titleScale }}
                className="z-0 flex flex-col items-center text-center px-6 pb-36 sm:pb-24 max-w-3xl"
            >
                <h1 className="text-[clamp(2.5rem,min(11vw,11svh),5.5rem)] font-bold tracking-tighter leading-[0.98]">
                    {title}
                </h1>
                {description && (
                    <p className="mt-5 max-w-[46ch] text-base sm:text-lg text-[var(--muted-strong)]">
                        {description}
                    </p>
                )}
            </motion.div>

            {/* 3D Z-Space Plane */}
            <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{ transformStyle: "preserve-3d" }}
            >
                {TUNNEL_CARDS.map((card, i) => (
                    <TunnelCard
                        key={i}
                        card={card}
                        progress={smoothProgress}
                        pointer={pointer}
                        total={TUNNEL_CARDS.length}
                        stage={stage}
                    />
                ))}
            </div>

            {actions && (
                <div className="absolute bottom-16 left-0 right-0 z-30 flex flex-wrap items-center justify-center gap-3 px-4">
                    {actions}
                </div>
            )}

            {/* Scroll Prompt */}
            {!reduce && (
                <motion.div
                    aria-hidden="true"
                    style={{ opacity: promptOpacity }}
                    className="pointer-events-none absolute bottom-5 z-20 text-sm text-[var(--muted-strong)]"
                >
                    Scroll or swipe to explore
                </motion.div>
            )}
        </div>
    );
}

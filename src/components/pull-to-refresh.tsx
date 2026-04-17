"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "~/lib/utils";

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

export function PullToRefresh({
  children,
  className,
  onRefresh,
}: {
  children: React.ReactNode;
  className?: string;
  onRefresh?: () => Promise<void> | void;
}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (isRefreshing) return;
      const container = containerRef.current;
      if (!container || container.scrollTop !== 0) return;
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    },
    [isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPullingRef.current || isRefreshing) return;
      const container = containerRef.current;
      if (!container) return;

      const diff = e.touches[0].clientY - startYRef.current;
      if (diff > 0 && container.scrollTop === 0) {
        e.preventDefault();
        setPullDistance(Math.min(diff * 0.5, MAX_PULL));
      }
    },
    [isRefreshing],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPullingRef.current || isRefreshing) return;
    isPullingRef.current = false;

    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        if (onRefresh) {
          await onRefresh();
        } else {
          window.location.reload();
        }
      } catch (error) {
        console.error("Refresh error:", error);
      }
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 500);
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  useEffect(() => {
    if (!isMobile) return;
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isMobile, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <div ref={containerRef} className={cn("relative h-full overflow-auto", className)}>
      {isMobile && (
        <div
          className="absolute left-0 right-0 flex items-center justify-center transition-transform duration-200 ease-out"
          style={{
            transform: `translateY(${pullDistance - 40}px)`,
            opacity: pullDistance / PULL_THRESHOLD,
          }}
        >
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md",
              isRefreshing && "animate-spin",
            )}
          >
            <RefreshCw
              className="h-5 w-5 text-blue-600"
              style={{
                transform: isRefreshing ? "none" : `rotate(${(pullDistance / MAX_PULL) * 360}deg)`,
              }}
            />
          </div>
        </div>
      )}
      <div
        style={{
          transform: isMobile ? `translateY(${pullDistance}px)` : "none",
          transition: isPullingRef.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}

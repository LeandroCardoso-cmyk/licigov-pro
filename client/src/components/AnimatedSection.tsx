import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { ReactNode } from "react";

interface AnimatedSectionProps {
  children: ReactNode;
  animation?: "fade-in" | "slide-up" | "slide-left" | "slide-right";
  delay?: number;
  className?: string;
}

export function AnimatedSection({
  children,
  animation = "fade-in",
  delay = 0,
  className = "",
}: AnimatedSectionProps) {
  const { elementRef, isVisible } = useIntersectionObserver({
    threshold: 0.1,
    triggerOnce: true,
  });

  const animationClasses = {
    "fade-in": "opacity-0 animate-fade-in",
    "slide-up": "opacity-0 translate-y-10 animate-slide-up",
    "slide-left": "opacity-0 translate-x-10 animate-slide-left",
    "slide-right": "opacity-0 -translate-x-10 animate-slide-right",
  };

  const baseClass = animationClasses[animation];
  const visibleClass = isVisible ? "!opacity-100 !translate-y-0 !translate-x-0" : "";

  return (
    <div
      ref={elementRef}
      className={`${baseClass} ${visibleClass} ${className}`}
      style={{
        transitionDelay: `${delay}ms`,
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      {children}
    </div>
  );
}

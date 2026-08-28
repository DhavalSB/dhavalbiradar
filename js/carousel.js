const images = [
  {
    src: "/images/gallery/fullsrc/shore.jpeg",
    alt: "Aerial view of a rocky coastline",
  },
  {
    src: "/images/gallery/showcase/bay-tour/ggmain.jpeg",
    alt: "Golden Gate Bridge from above",
  },
  {
    src: "/images/gallery/fullsrc/Plane.jpeg",
    alt: "Airplane wing over clouds at sunset",
  },
];

const INTERVAL_MS = 5000;

document.addEventListener("DOMContentLoaded", () => {
  const carousel = document.getElementById("hero-carousel");
  const dots = document.querySelectorAll(".section-ellipsis .carousel-dot");
  if (!carousel || dots.length === 0) return;

  const slides = carousel.querySelectorAll("img");
  let index = 0;
  let timer = null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function show(i) {
    index = (i + images.length) % images.length;
    slides.forEach((img, n) => {
      img.classList.toggle("is-active", n === index);
    });
    dots.forEach((dot, n) => {
      dot.classList.toggle("active", n === index);
      dot.setAttribute("aria-selected", n === index ? "true" : "false");
    });
  }

  function next() {
    show(index + 1);
  }

  function start() {
    if (reduceMotion) return;
    stop();
    timer = setInterval(next, INTERVAL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      show(i);
      start();
    });
  });

  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);
  document.querySelector(".section-ellipsis")?.addEventListener("mouseenter", stop);
  document.querySelector(".section-ellipsis")?.addEventListener("mouseleave", start);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  images.forEach((image) => {
    const preload = new Image();
    preload.src = image.src;
  });

  show(0);
  start();
});

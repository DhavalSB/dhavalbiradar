document.addEventListener("DOMContentLoaded", function () {
  const galleryImages = document.querySelectorAll(".photo-gallery img, .showcase-gallery img");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const nextImg = document.getElementById("lightbox-img-next");
  const closeButton = document.querySelector(".lightbox-close");
  const prevButton = document.querySelector(".lightbox-prev");
  const nextButton = document.querySelector(".lightbox-next");
  const dotsContainer = document.querySelector(".lightbox-dots");

  let currentGroup = [];
  let currentIndex = 0;

  function updateDots() {
    dotsContainer.innerHTML = "";
    if (currentGroup.length <= 1) {
      dotsContainer.classList.add("hidden");
      return;
    }
    dotsContainer.classList.remove("hidden");
    currentGroup.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.classList.add("lightbox-dot");
      if (i === currentIndex) dot.classList.add("active");
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        showImage(i, i > currentIndex ? "left" : "right");
      });
      dotsContainer.appendChild(dot);
    });
  }

  let animating = false;

  function showImage(index, direction) {
    if (animating && direction) return;
    currentIndex = index;

    if (direction) {
      animating = true;

      const startAnim = () => {
        nextImg.classList.add("animating");

        // Position next image off-screen
        const startPos = direction === "left" ? "100%" : "-100%";
        const endPos = direction === "left" ? "-100%" : "100%";

        nextImg.style.transition = "none";
        nextImg.style.transform = `translateX(${startPos})`;

        // Force reflow
        nextImg.offsetHeight;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Current image slides out
            lightboxImg.style.transition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
            lightboxImg.style.transform = `translateX(${endPos})`;

            // Next image slides in
            nextImg.style.transition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
            nextImg.style.transform = "translateX(0)";

            // Cleanup after transition
            const cleanup = () => {
              lightboxImg.src = nextImg.src;
              lightboxImg.style.transition = "none";
              lightboxImg.style.transform = "translateX(0)";

              nextImg.classList.remove("animating");
              nextImg.src = "";
              nextImg.style.transition = "none";

              animating = false;
              nextImg.removeEventListener("transitionend", cleanup);
            };

            nextImg.addEventListener("transitionend", cleanup);
          });
        });
      };

      // Set src and wait for load if needed
      nextImg.onload = startAnim;
      nextImg.src = currentGroup[currentIndex];

      // If cached/complete, trigger manually
      if (nextImg.complete) {
        nextImg.onload = null;
        startAnim();
      }

    } else {
      lightboxImg.style.transition = "none";
      lightboxImg.style.transform = "translateX(0)";
      lightboxImg.src = currentGroup[currentIndex];
    }

    // Show/hide arrows based on group size
    const hasGroup = currentGroup.length > 1;
    prevButton.classList.toggle("hidden", !hasGroup);
    nextButton.classList.toggle("hidden", !hasGroup);

    updateDots();
  }

  function openLightbox(fullSrc, group) {
    if (group && group.length > 0) {
      currentGroup = group;
      currentIndex = group.indexOf(fullSrc);
      if (currentIndex === -1) currentIndex = 0;
    } else {
      currentGroup = [fullSrc];
      currentIndex = 0;
    }

    showImage(currentIndex);
    lightbox.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.add("hidden");
    lightboxImg.src = "";
    currentGroup = [];
    currentIndex = 0;
    dotsContainer.classList.add("hidden");
    document.body.style.overflow = "";
    dotsContainer.innerHTML = "";
  }

  // Build group map from data-group attributes
  const groups = {};
  galleryImages.forEach((img) => {
    const groupName = img.getAttribute("data-group");
    if (groupName) {
      if (!groups[groupName]) groups[groupName] = [];
      const fullSrc = img.getAttribute("data-fullsrc") || img.src;
      groups[groupName].push(fullSrc);
    }
  });

  galleryImages.forEach((img) => {
    img.addEventListener("click", (e) => {
      if (img.closest("a")) return;

      const fullSrc = img.getAttribute("data-fullsrc") || img.src;
      const groupName = img.getAttribute("data-group");
      const group = groupName ? groups[groupName] : null;

      openLightbox(fullSrc, group);
    });
  });

  // Arrow navigation
  prevButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentGroup.length > 1) {
      showImage((currentIndex - 1 + currentGroup.length) % currentGroup.length, "right");
    }
  });

  nextButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentGroup.length > 1) {
      showImage((currentIndex + 1) % currentGroup.length, "left");
    }
  });

  // Close on background click
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Close on button click
  closeButton.addEventListener("click", closeLightbox);

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("hidden")) return;

    if (e.key === "Escape") {
      closeLightbox();
    } else if (e.key === "ArrowLeft" && currentGroup.length > 1) {
      showImage((currentIndex - 1 + currentGroup.length) % currentGroup.length, "right");
    } else if (e.key === "ArrowRight" && currentGroup.length > 1) {
      showImage((currentIndex + 1) % currentGroup.length, "left");
    }
  });

  // Touch/swipe support for mobile
  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = false;

  lightbox.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    swiping = false;
  }, { passive: true });

  // Prevent vertical scroll during horizontal swipe
  lightbox.addEventListener("touchmove", (e) => {
    if (currentGroup.length <= 1) return;
    const dx = Math.abs(e.changedTouches[0].screenX - touchStartX);
    const dy = Math.abs(e.changedTouches[0].screenY - touchStartY);
    if (dx > dy && dx > 10) {
      swiping = true;
      e.preventDefault();
    }
  }, { passive: false });

  lightbox.addEventListener("touchend", (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;

    if (currentGroup.length <= 1) return;

    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        showImage((currentIndex + 1) % currentGroup.length, "left");
      } else {
        showImage((currentIndex - 1 + currentGroup.length) % currentGroup.length, "right");
      }
    }
  }, { passive: true });
});

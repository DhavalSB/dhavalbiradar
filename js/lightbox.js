document.addEventListener("DOMContentLoaded", function () {
  const galleryImages = document.querySelectorAll(".photo-gallery img, .showcase-gallery img");

  galleryImages.forEach((img) => {
    img.addEventListener("click", (e) => {
      // Skip lightbox for linked images
      if (img.closest("a")) return;

      const fullSrc = img.getAttribute("data-fullsrc") || img.src;
      const lightbox = document.getElementById("lightbox");
      const lightboxImg = document.getElementById("lightbox-img");

      lightboxImg.src = fullSrc;
      lightbox.classList.remove("hidden");
    });
  });

  const lightbox = document.getElementById("lightbox");
  const closeButton = document.querySelector(".lightbox-close");
  
  // Close on background click
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      lightbox.classList.add("hidden");
      document.getElementById("lightbox-img").src = "";
    }
  });
  
  // Close on button click
  closeButton.addEventListener("click", () => {
    lightbox.classList.add("hidden");
    document.getElementById("lightbox-img").src = "";
  });
});

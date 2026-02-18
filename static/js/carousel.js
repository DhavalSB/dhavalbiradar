const images = [
  '/images/gallery/1.jpeg',
  '/images/gallery/2.jpeg',
  '/images/gallery/valley.png'
];

let index = 0;

function updateImage() {
  const img = document.getElementById('carousel-image');
  if (img) {
    img.src = images[index];
  }

}

function moveSlide(direction) {
  index = (index + direction + images.length) % images.length;
  updateImage();
}

document.addEventListener('DOMContentLoaded', () => {
  updateImage();

  document.getElementById('carousel-prev')?.addEventListener('click', () => moveSlide(-1));
  document.getElementById('carousel-next')?.addEventListener('click', () => moveSlide(1));
})

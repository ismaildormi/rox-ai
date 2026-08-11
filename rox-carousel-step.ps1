$path = ".\frontend\index.html"

$old = '<div class="fcard-thumb" data-open="images" style="background-image:linear-gradient(135deg,#2a1408,#6d28d9 55%,#ffd166);"></div>'

$new = @"
<div class="fcard-thumb rox-images-carousel" data-open="images">
  <img class="rox-carousel-img is-active" src="images-carousel/IMG_3449.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3452.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3453.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3454.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3455.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3457.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3458.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3460.PNG" alt="">
  <img class="rox-carousel-img" src="images-carousel/IMG_3461.PNG" alt="">
</div>

<style>
.rox-images-carousel {
  position: relative;
  overflow: hidden;
  background: #111;
}
.rox-images-carousel .rox-carousel-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity .55s ease;
  pointer-events: none;
}
.rox-images-carousel .rox-carousel-img.is-active {
  opacity: 1;
}
</style>

<script>
document.addEventListener("DOMContentLoaded", function () {
  const carousel = document.querySelector(".rox-images-carousel");
  if (!carousel) return;

  const images = carousel.querySelectorAll(".rox-carousel-img");
  if (images.length < 2) return;

  let current = 0;

  setInterval(function () {
    images[current].classList.remove("is-active");
    current = (current + 1) % images.length;
    images[current].classList.add("is-active");
  }, 2500);
});
</script>
"@

$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($path, $utf8)

$count = ([regex]::Matches($text, [regex]::Escape($old))).Count

if ($count -ne 1) {
  throw "SAFETY STOP: expected exactly 1 AI Images target, found $count. Nothing changed."
}

Write-Host "READY: final 9-image carousel script prepared. index.html not changed."

$updated = $text.Replace($old, $new)

if ($updated -eq $text) {
  throw "SAFETY STOP: replacement produced no change. Nothing written."
}

[System.IO.File]::WriteAllText($path, $updated, $utf8)

Write-Host "OK: Rox AI Images carousel installed safely."

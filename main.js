// =========================================
//  INTRO SCREEN
// =========================================
const intro   = document.getElementById('intro');
const enterBtn = document.getElementById('enterBtn');
const mainSite = document.getElementById('mainSite');
const heroCards = document.getElementById('heroCards');
const BACKEND_BASE_URL = 'http://127.0.0.1:3000';
const BACKEND_UPLOAD_URL = `${BACKEND_BASE_URL}/upload`;
const BACKEND_IMAGES_URL = `${BACKEND_BASE_URL}/images`;

function openMainSite() {
  intro?.remove();
  mainSite.classList.remove('hidden');
  initReveal();
  setTimeout(() => heroCards?.classList.add('active'), 120);
}

const hasSeenIntro = sessionStorage.getItem('galleryIntroSeen') === 'true';
if (hasSeenIntro) {
  openMainSite();
}

enterBtn.addEventListener('click', () => {
  sessionStorage.setItem('galleryIntroSeen', 'true');
  intro.classList.add('fade-out');
  setTimeout(() => {
    openMainSite();
  }, 800);
});

// =========================================
//  NAVBAR SCROLL EFFECT
// =========================================
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  nav?.classList.toggle('scrolled', window.scrollY > 40);
});

// =========================================
//  GALLERY STATE
// =========================================
let galleryItems = []; // { type, src, name }
let currentFilter = 'all';
let currentLbIndex = 0;

function renderGallery() {
  const grid   = document.getElementById('galleryGrid');
  const empty  = document.getElementById('emptyState');
  const filtered = galleryItems.filter(
    i => currentFilter === 'all' || i.type === currentFilter
  );

  grid.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.add('show');
    updateHeroCards();
    return;
  }
  empty.classList.remove('show');

  filtered.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'gallery-item';
    card.dataset.index = galleryItems.indexOf(item);
    card.style.animationDelay = `${idx * 0.06}s`;

    if (item.type === 'photo') {
      card.innerHTML = `
        <img src="${item.src}" alt="${item.name}" loading="lazy"/>
        <div class="overlay">
          <i class="fa-regular fa-expand overlay-icon"></i>
        </div>`;
    } else {
      card.innerHTML = `
        <video src="${item.src}" muted preload="metadata"></video>
        <div class="video-badge"><i class="fa-solid fa-play"></i> Video</div>
        <div class="overlay">
          <i class="fa-regular fa-circle-play overlay-icon"></i>
        </div>`;
    }

    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
      const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
      card.style.setProperty('--card-tx', `${dx * 10}px`);
      card.style.setProperty('--card-ty', `${dy * 8}px`);
    });

    card.addEventListener('mouseleave', () => {
      card.style.setProperty('--card-tx', '0px');
      card.style.setProperty('--card-ty', '0px');
    });

    card.addEventListener('click', () => openLightbox(parseInt(card.dataset.index)));
    grid.appendChild(card);
  });
  updateHeroCards();
}

async function loadGalleryImages() {
  try {
    const response = await fetch(BACKEND_IMAGES_URL, { method: 'GET' });
    if (!response.ok) {
      console.warn('Unable to load existing gallery images.');
      return;
    }
    const data = await response.json();
    if (!data.success || !Array.isArray(data.images)) return;

    const seen = new Set();
    galleryItems = data.images
      .filter(item => item.url && !item.url.includes('undefined'))
      .map(item => {
        const extension = (item.fileName || '').split('.').pop()?.toLowerCase();
        const type = ['mp4', 'mov', 'webm'].includes(extension) ? 'video' : 'photo';
        const fileId = item.fileId || getFileIdFromUrl(item.url);
        return {
          type,
          src: item.url,
          name: item.fileName || item.fileId || item.url,
          fileId,
        };
      })
      .filter(item => {
        const key = item.fileId || item.src;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    renderGallery();
  } catch (error) {
    console.warn('Error loading gallery images:', error);
  }
}

function getFileIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const match2 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match2 ? match2[1] : null;
}

function getRandomPhotos(items, count) {
  const photos = items.filter(item => item.type === 'photo');
  if (photos.length === 0) return [];
  const shuffled = [...photos].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function updateHeroCards() {
  if (!heroCards) return;
  const photos = getRandomPhotos(galleryItems, 3);
  heroCards.querySelectorAll('.hero-card').forEach((card, index) => {
    const item = photos[index];
    card.innerHTML = item
      ? `<div class="card-inner"><img src="${item.src}" alt="${item.name}" class="card-img"/></div>`
      : `<div class="card-inner"><div class="card-placeholder">Upload foto untuk melihat preview di sini</div></div>`;
  });
}

// =========================================
//  FILTER BUTTONS
// =========================================
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderGallery();
  });
});

// =========================================
//  UPLOAD — DROP ZONE
// =========================================
const dropZone   = document.getElementById('dropZone');
const fileInput  = document.getElementById('fileInput');
const previewList= document.getElementById('previewList');
const uploadBtn  = document.getElementById('uploadBtn');
const uploadError = document.getElementById('uploadError');

let pendingFiles = []; // { file, src, type }

function showUploadError(message) {
  if (!uploadError) return;
  uploadError.textContent = message;
  uploadError.classList.remove('hidden');
}

function clearUploadError() {
  if (!uploadError) return;
  uploadError.textContent = '';
  uploadError.classList.add('hidden');
}

dropZone.addEventListener('click', e => {
  if (e.target.closest('.btn-upload')) return;
  fileInput.click();
});

const uploadLabel = document.querySelector('.btn-upload');
if (uploadLabel) {
  uploadLabel.addEventListener('click', e => {
    e.stopPropagation();
  });
}

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;

    const reader = new FileReader();
    reader.onload = e => {
      const src  = e.target.result;
      const type = file.type.startsWith('image/') ? 'photo' : 'video';
      pendingFiles.push({ file, src, type, name: file.name });
      renderPreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderPreview() {
  clearUploadError();
  previewList.innerHTML = '';
  pendingFiles.forEach((pf, i) => {
    const div = document.createElement('div');
    div.className = 'preview-item';
    div.innerHTML = pf.type === 'photo'
      ? `<img src="${pf.src}" alt="${pf.name}"/>`
      : `<video src="${pf.src}" muted></video>`;
    div.innerHTML += `<button class="remove-btn" data-i="${i}">
      <i class="fa-solid fa-xmark"></i></button>`;

    div.addEventListener('mousemove', e => {
      const rect = div.getBoundingClientRect();
      const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
      const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
      div.style.setProperty('--preview-tx', `${dx * 10}px`);
      div.style.setProperty('--preview-ty', `${dy * 6}px`);
    });
    div.addEventListener('mouseleave', () => {
      div.style.setProperty('--preview-tx', '0px');
      div.style.setProperty('--preview-ty', '0px');
    });

    previewList.appendChild(div);
  });

  previewList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pendingFiles.splice(parseInt(btn.dataset.i), 1);
      renderPreview();
      uploadBtn.disabled = pendingFiles.length === 0;
    });
  });

  uploadBtn.disabled = pendingFiles.length === 0;
  fileInput.value = '';
}

async function uploadFileToBackend(file) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(BACKEND_UPLOAD_URL, {
    method: 'POST',
    body: formData,
    mode: 'cors',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.message || `Upload failed with status ${response.status}`);
  }

  return response.json();
}

uploadBtn.addEventListener('click', async () => {
  if (pendingFiles.length === 0) return;

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Mengunggah...';

  try {
    const uploadedItems = [];

    for (const pf of pendingFiles) {
      const result = await uploadFileToBackend(pf.file);
      uploadedItems.unshift({ type: pf.type, src: result.url, name: pf.file.name });
    }

    galleryItems.unshift(...uploadedItems);
    pendingFiles = [];
    previewList.innerHTML = '';

    currentFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="all"]').classList.add('active');
    renderGallery();

    document.getElementById('gallery').scrollIntoView({ behavior: 'smooth' });

    uploadBtn.textContent = '✓ Berhasil diupload!';
    setTimeout(() => {
      uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload ke Galeri';
      uploadBtn.disabled = true;
    }, 2500);
  } catch (err) {
    showUploadError(err.message || 'Upload gagal. Periksa backend dan koneksi.');
    uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload ke Galeri';
    uploadBtn.disabled = pendingFiles.length === 0;
  }
});

// =========================================
//  LIGHTBOX
// =========================================
const lightbox = document.getElementById('lightbox');
const lbContent= document.getElementById('lbContent');
const lbCaption= document.getElementById('lbCaption');

function openLightbox(index) {
  currentLbIndex = index;
  updateLightbox();
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function updateLightbox() {
  const item = galleryItems[currentLbIndex];
  lbContent.innerHTML = item.type === 'photo'
    ? `<img src="${item.src}" alt="${item.name}"/>`
    : `<video src="${item.src}" controls autoplay></video>`;
  lbCaption.textContent = item.name;
}

document.getElementById('lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => {
  if (e.target === lightbox) closeLightbox();
});

document.getElementById('lbPrev').addEventListener('click', () => {
  currentLbIndex = (currentLbIndex - 1 + galleryItems.length) % galleryItems.length;
  updateLightbox();
});
document.getElementById('lbNext').addEventListener('click', () => {
  currentLbIndex = (currentLbIndex + 1) % galleryItems.length;
  updateLightbox();
});

document.addEventListener('keydown', e => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') {
    currentLbIndex = (currentLbIndex - 1 + galleryItems.length) % galleryItems.length;
    updateLightbox();
  }
  if (e.key === 'ArrowRight') {
    currentLbIndex = (currentLbIndex + 1) % galleryItems.length;
    updateLightbox();
  }
});

function closeLightbox() {
  lightbox.classList.add('hidden');
  document.body.style.overflow = '';
  lbContent.innerHTML = '';
}

// =========================================
//  SCROLL REVEAL
// =========================================
function initReveal() {
  const targets = document.querySelectorAll(
    '.section-header, .upload-card, .filter-bar, .gallery-grid'
  );
  targets.forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  targets.forEach(el => observer.observe(el));
}

// =========================================
//  INIT
// =========================================
loadGalleryImages();
renderGallery(); // tampil kosong dulu

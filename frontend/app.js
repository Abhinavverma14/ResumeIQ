const API_BASE = 'http://localhost:8080';

// ─── CANVAS BACKGROUND ───
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createParticles() {
  particles = [];
  const count = Math.floor((canvas.width * canvas.height) / 15000);
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.5 + 0.1,
      color: Math.random() > 0.5 ? '59,130,246' : '99,102,241'
    });
  }
}

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw connections
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(59,130,246,${0.08 * (1 - dist / 120)})`;
        ctx.lineWidth = 0.5;
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }

  // Draw particles
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color},${p.opacity})`;
    ctx.fill();
  });

  requestAnimationFrame(drawParticles);
}

window.addEventListener('resize', () => { resizeCanvas(); createParticles(); });
resizeCanvas();
createParticles();
drawParticles();

// ─── HELPERS ───
function getFitClass(fitLabel) {
  if (!fitLabel) return 'partial';
  const f = fitLabel.toLowerCase();
  if (f.includes('strong')) return 'strong';
  if (f.includes('good')) return 'good';
  return 'partial';
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getScoreColor(score) {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'good';
  return 'partial';
}

// ─── FETCH CANDIDATES ───
async function fetchCandidates() {
  const skills = document.getElementById('filter-skills').value.trim();
  const keyword = document.getElementById('filter-keyword').value.trim();
  const minExp = document.getElementById('filter-min-exp').value;
  const maxExp = document.getElementById('filter-max-exp').value;

  let url = `${API_BASE}/candidates?limit=100`;
  if (skills) url += `&skills=${encodeURIComponent(skills)}`;
  if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;
  if (minExp) url += `&min_exp=${minExp}`;
  if (maxExp) url += `&max_exp=${maxExp}`;

  showLoading(true);

  try {
    const res = await fetch(url);
    const data = await res.json();
    renderCandidates(data.candidates || []);
  } catch (err) {
    console.error('API Error:', err);
    showEmpty(true);
  } finally {
    showLoading(false);
  }
}

// ─── RENDER CANDIDATES ───
function renderCandidates(candidates) {
  const grid = document.getElementById('candidates-grid');
  const emptyState = document.getElementById('empty-state');

  grid.innerHTML = '';

  if (!candidates || candidates.length === 0) {
    showEmpty(true);
    updateStats([]);
    return;
  }

  showEmpty(false);
  updateStats(candidates);

  document.getElementById('total-count').textContent = `${candidates.length} Candidates`;

  candidates.forEach((c, index) => {
    const fitClass = getFitClass(c.fit_label);
    const scoreClass = getScoreColor(c.match_score || 0);
    const skills = Array.isArray(c.skills) ? c.skills : [];
    const visibleSkills = skills.slice(0, 4);
    const extraSkills = skills.length - 4;

    const card = document.createElement('div');
    card.className = `candidate-card ${fitClass}`;
    card.style.animationDelay = `${index * 0.05}s`;
    card.onclick = () => openModal(c);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-avatar ${fitClass}">${getInitials(c.full_name)}</div>
        <div class="card-score">
          <div class="score-value ${scoreClass}">${(c.match_score || 0).toFixed(0)}%</div>
          <div class="score-label">Match</div>
        </div>
      </div>
      <div class="card-name">${c.full_name || 'Unknown'}</div>
      <div class="card-role">${c.current_role || 'Role not specified'} ${c.current_company ? '@ ' + c.current_company : ''}</div>
      <div class="card-info">
        <div class="info-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${c.total_exp_years || 0} yrs exp
        </div>
        <div class="info-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${c.location || 'Location N/A'}
        </div>
      </div>
      <div class="skills-wrap">
        ${visibleSkills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
        ${extraSkills > 0 ? `<span class="skill-tag more">+${extraSkills}</span>` : ''}
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span class="fit-badge ${fitClass}">
          ${fitClass === 'strong' ? '●' : fitClass === 'good' ? '●' : '●'} ${c.fit_label || 'Not Assessed'}
        </span>
      </div>
      <div class="score-bar-wrap">
        <div class="score-bar-bg">
          <div class="score-bar-fill ${scoreClass}" style="width: ${c.match_score || 0}%"></div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ─── UPDATE STATS ───
function updateStats(candidates) {
  document.getElementById('stat-total').textContent = candidates.length;
  document.getElementById('stat-strong').textContent =
    candidates.filter(c => getFitClass(c.fit_label) === 'strong').length;
  document.getElementById('stat-good').textContent =
    candidates.filter(c => getFitClass(c.fit_label) === 'good').length;
  document.getElementById('stat-partial').textContent =
    candidates.filter(c => getFitClass(c.fit_label) === 'partial').length;
}

// ─── MODAL ───
function openModal(c) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const fitClass = getFitClass(c.fit_label);
  const skills = Array.isArray(c.skills) ? c.skills : [];
  const strengths = Array.isArray(c.strengths) ? c.strengths : [];
  const gaps = Array.isArray(c.gaps) ? c.gaps : [];
  const keywords = Array.isArray(c.keywords) ? c.keywords : [];

  body.innerHTML = `
    <div class="modal-header">
      <div class="modal-name">${c.full_name || 'Unknown'}</div>
      <div class="modal-role">${c.current_role || ''} ${c.current_company ? '@ ' + c.current_company : ''}</div>
      <div class="modal-badges">
        <span class="fit-badge ${fitClass}">${c.fit_label || 'Not Assessed'}</span>
        <span class="fit-badge good">${(c.match_score || 0).toFixed(0)}% Match</span>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Contact Info</div>
      <div class="modal-info-grid">
        <div class="modal-info-item"><strong>Email</strong>${c.email || 'N/A'}</div>
        <div class="modal-info-item"><strong>Phone</strong>${c.phone || 'N/A'}</div>
        <div class="modal-info-item"><strong>Location</strong>${c.location || 'N/A'}</div>
        <div class="modal-info-item"><strong>Experience</strong>${c.total_exp_years || 0} years</div>
        ${c.linkedin_url ? `<div class="modal-info-item"><strong>LinkedIn</strong><a href="${c.linkedin_url}" target="_blank" style="color:var(--accent)">${c.linkedin_url}</a></div>` : ''}
        ${c.github_url ? `<div class="modal-info-item"><strong>GitHub</strong><a href="${c.github_url}" target="_blank" style="color:var(--accent)">${c.github_url}</a></div>` : ''}
      </div>
    </div>

    ${c.summary ? `
    <div class="modal-section">
      <div class="modal-section-title">AI Summary</div>
      <div class="modal-summary">${c.summary}</div>
    </div>` : ''}

    ${skills.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">Skills</div>
      <div class="modal-tags">
        ${skills.map(s => `<span class="modal-tag">${s}</span>`).join('')}
      </div>
    </div>` : ''}

    ${keywords.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">Keywords</div>
      <div class="modal-tags">
        ${keywords.map(k => `<span class="modal-tag">${k}</span>`).join('')}
      </div>
    </div>` : ''}

    ${strengths.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">Strengths</div>
      <div class="modal-tags">
        ${strengths.map(s => `<span class="modal-tag green">${s}</span>`).join('')}
      </div>
    </div>` : ''}

    ${gaps.length > 0 ? `
    <div class="modal-section">
      <div class="modal-section-title">Gaps / Concerns</div>
      <div class="modal-tags">
        ${gaps.map(g => `<span class="modal-tag red">${g}</span>`).join('')}
      </div>
    </div>` : ''}
  `;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.body.style.overflow = '';
}

// ─── RESET FILTERS ───
function resetFilters() {
  document.getElementById('filter-skills').value = '';
  document.getElementById('filter-keyword').value = '';
  document.getElementById('filter-min-exp').value = '';
  document.getElementById('filter-max-exp').value = '';
  fetchCandidates();
}

// ─── UTILS ───
function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('candidates-grid').innerHTML = '';
}

function showEmpty(show) {
  document.getElementById('empty-state').style.display = show ? 'flex' : 'none';
}

// ─── KEYBOARD ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter') fetchCandidates();
});

// ─── INIT ───
fetchCandidates();
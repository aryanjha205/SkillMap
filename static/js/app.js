let map;
let markers = [];
let userLocation = { lat: 28.6139, lng: 77.2090 }; // Default: New Delhi
let currentFilter = 'All';
let activeJob = null;
let trackingWorkerMarker = null;
let trackingUserMarker = null;
let trackingPath = null;
let workerInitialPos = null;
let bookingState = null; // New variable
let isTracking = false; // New variable
let partnerOnline = true; // Global early declaration // New variable
let partnerJobsCache = [];
let deferredInstallPrompt = null;
let workersCache = [];
const terminalJobStatuses = ['Paid', 'Cancelled', 'Rejected', 'Expired'];
const actionableCustomerStatuses = ['Accepted', 'On the Way', 'Reached', 'Completed', 'Pending'];

function setInlineMessage(elementId, message = '', tone = 'info') {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
        el.classList.add('hidden');
        el.textContent = '';
        if (elementId === 'partner-status-banner') {
            const inner = el.querySelector('div');
            if (inner) inner.textContent = '';
        }
        return;
    }

    const styles = {
        info: ['bg-indigo-50', 'text-indigo-700', 'border', 'border-indigo-100'],
        success: ['bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-100'],
        error: ['bg-rose-50', 'text-rose-700', 'border', 'border-rose-100']
    };
    const toneClasses = styles[tone] || styles.info;

    if (elementId === 'partner-status-banner') {
        const inner = el.querySelector('div');
        if (!inner) return;
        inner.className = `glass-card px-4 py-3 text-center text-sm font-bold ${toneClasses.join(' ')}`;
        inner.textContent = message;
        el.classList.remove('hidden');
        return;
    }

    el.className = `mb-6 rounded-2xl px-4 py-3 text-sm font-bold ${toneClasses.join(' ')}`;
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearInlineMessages() {
    ['auth-status', 'booking-status', 'partner-status-banner'].forEach((id) => setInlineMessage(id, ''));
}

function setOtpPreview(otp = '') {
    const preview = document.getElementById('auth-otp-preview');
    if (!preview) return;
    if (!otp) {
        preview.textContent = '';
        preview.classList.add('hidden');
        return;
    }
    preview.textContent = otp;
    preview.classList.remove('hidden');
}

function showAppFeedback(message, tone = 'info') {
    const targets = ['partner-status-banner', 'booking-status', 'auth-status'];
    const availableTarget = targets.find((id) => document.getElementById(id));
    if (availableTarget) {
        setInlineMessage(availableTarget, message, tone);
    } else {
        console.log(message);
    }
}

// Role enforcement logic
const userRole = localStorage.getItem('userRole'); // New constant
const currentPath = window.location.pathname; // New constant

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButton() {
    const installBtn = document.getElementById('install-app-btn');
    if (!installBtn) return;

    const canInstall = Boolean(deferredInstallPrompt) && !isStandaloneMode();
    installBtn.classList.toggle('hidden', !canInstall);
}

async function promptInstallApp() {
    if (!deferredInstallPrompt) return;

    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult.outcome === 'accepted') {
        deferredInstallPrompt = null;
    }
    updateInstallButton();
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButton();
});

// Initialize Map
function initMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl || mapEl.classList.contains('hidden') || map) return;
    
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([userLocation.lat, userLocation.lng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Initial user marker
    trackingUserMarker = L.marker([userLocation.lat, userLocation.lng], {
        icon: L.divIcon({
            className: 'custom-user-icon',
            html: `<div class="w-12 h-12 bg-indigo-600 rounded-full border-4 border-white shadow-xl flex items-center justify-center text-white ring-4 ring-indigo-600/20">
                    <i class="fas fa-home text-lg"></i>
                   </div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
        })
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    
    // Start locating immediately
    detectLocation();
}

function detectLocation() {
    if (navigator.geolocation) {
        // High accuracy for initial fix
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                
                if (map) {
                    map.setView([userLocation.lat, userLocation.lng], 15);
                    if (trackingUserMarker) {
                        trackingUserMarker.setLatLng([userLocation.lat, userLocation.lng])
                                          .bindPopup("You are here")
                                          .openPopup();
                    }
                }
                
                // Update UI data based on new location
                loadWorkers();
                updateAIRecommendation();
            },
            (err) => {
                console.warn("Location access denied. Using standard view.");
                // Optionally could use an IP-based location API here for better fallback
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }
}

async function loadWorkers() {
    try {
        const res = await fetch('/api/workers/');
        const workers = await res.json();
        workersCache = Array.isArray(workers) ? workers : [];
        renderMarkers(workersCache);
    } catch (err) {
        console.error("Load workers error:", err);
    }
}

function renderMarkers(workers) {
    if (!map) return;
    // Clear existing
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // ENFORCEMENT: Partners should not see other partners to book.
    const userRole = localStorage.getItem('userRole');
    if (userRole === 'partner') return;

    const normalizedFilter = (currentFilter || 'All').trim().toLowerCase();
    const filtered = normalizedFilter === 'all'
        ? workers
        : workers.filter(w => {
            const skill = (w.skill || '').toLowerCase();
            const name = (w.name || '').toLowerCase();
            const email = (w.email || '').toLowerCase();
            return skill.includes(normalizedFilter) || name.includes(normalizedFilter) || email.includes(normalizedFilter);
        });

    filtered.forEach(worker => {
        const lat = Number(worker.lat);
        const lng = Number(worker.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const safePhoto = worker.photo_url || 'https://via.placeholder.com/150';
        const safeName = worker.name || 'Partner';
        const safeSkill = worker.skill || 'General Service';
        const safePrice = Number(worker.price || 0);
        const safeEmail = worker.email || '';
        const safeRating = worker.rating || 5.0;

        const marker = L.marker([lat, lng], {
            workerId: worker.id,
            icon: L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="w-10 h-10 bg-white rounded-2xl shadow-lg border-2 border-indigo-500 overflow-hidden flex items-center justify-center">
                        <img src="${safePhoto}" class="w-full h-full object-cover">
                       </div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(map);

        const userRole = localStorage.getItem('userRole');
        const isCustomer = userRole === 'customer';

        const popupContent = `
            <div class="glass p-4 rounded-3xl w-64 shadow-2xl border-none">
                <div class="flex gap-3 mb-3">
                    <img src="${safePhoto}" class="w-16 h-16 rounded-2xl object-cover shadow-sm">
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${safeName}</h4>
                        <div class="flex items-center text-amber-500 text-[10px]">
                            <i class="fas fa-star mr-1"></i> ${safeRating}
                            <span class="text-slate-400 ml-1">(${worker.reviews_count || 12} reviews)</span>
                        </div>
                        <p class="text-indigo-600 font-bold text-xs uppercase tracking-wider mt-0.5">${safeSkill}</p>
                    </div>
                </div>
                <div class="flex justify-between items-center mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Rate</span>
                    <span class="font-black text-slate-800 text-sm">₹${safePrice}/hr</span>
                </div>
                <div class="${isCustomer ? 'grid grid-cols-2' : ''} gap-2">
                    <button onclick="viewWorkerProfile('${worker.id}', '${safeEmail}')" 
                            class="w-full bg-indigo-50 text-indigo-600 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all">View Profile</button>
                    ${isCustomer ? `
                    <button onclick="hireWorker('${worker.id}', '${safeName}', '${safeSkill}', '${safePrice}', '${safePhoto}')" 
                            class="bg-indigo-600 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700">Book Now</button>
                    ` : ''}
                </div>
                ${isCustomer ? `
                <button onclick="quickRequest('${worker.id}')" 
                        class="w-full mt-3 bg-white text-slate-400 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border border-slate-200 hover:bg-rose-50 hover:text-rose-600 transition-colors">
                        ⚡ Quick Request</button>
                ` : ''}
            </div>
        `;

        marker.bindPopup(popupContent, {
            className: 'custom-popup',
            maxWidth: 300
        });
        markers.push(marker);
    });

    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds(), { padding: [60, 60] });
    }
}

function getFilteredWorkersList() {
    const normalizedFilter = (currentFilter || 'All').trim().toLowerCase();
    if (normalizedFilter === 'all') return workersCache;
    return workersCache.filter((worker) => {
        const skill = (worker.skill || '').toLowerCase();
        const name = (worker.name || '').toLowerCase();
        const email = (worker.email || '').toLowerCase();
        return skill.includes(normalizedFilter) || name.includes(normalizedFilter) || email.includes(normalizedFilter);
    });
}

function selectCustomerActiveJob(jobs) {
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    const active = jobs.filter((job) => !terminalJobStatuses.includes(job.status));
    if (active.length === 0) return null;
    const priority = { 'Accepted': 0, 'On the Way': 1, 'Reached': 2, 'Completed': 3, 'Pending': 4 };
    return active.sort((a, b) => {
        const statusDiff = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return (b.created_at || '').localeCompare(a.created_at || '');
    })[0];
}

function selectPartnerDashboardJob(jobs) {
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    const active = jobs.filter((job) => ['Accepted', 'On the Way', 'Reached', 'Completed', 'Pending'].includes(job.status));
    if (active.length === 0) return null;
    const priority = { 'Accepted': 0, 'On the Way': 1, 'Reached': 2, 'Completed': 3, 'Pending': 4 };
    return active.sort((a, b) => {
        const statusDiff = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return (b.created_at || '').localeCompare(a.created_at || '');
    })[0];
}

async function viewWorkerProfile(id, email) {
    await openProfile(email);
}

// AI Recommendation
async function updateAIRecommendation() {
    try {
        const res = await fetch('/api/workers/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: userLocation.lat,
                lng: userLocation.lng
            })
        });
        const recommendations = await res.json();

        if (recommendations.length > 0) {
            const best = recommendations[0];
            const panel = document.getElementById('recommendation-panel');
            const content = document.getElementById('best-worker-content');
            if (!panel || !content) return;

            panel.classList.remove('hidden');
            content.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="${best.photo_url}" class="w-12 h-12 rounded-xl object-cover">
                    <div class="flex-1">
                        <p class="font-bold text-slate-800 text-sm">${best.name}</p>
                        <p class="text-indigo-600 text-xs font-medium">${best.distance}km</p>
                    </div>
                    <button onclick="hireWorker('${best.id}', '${best.name}', '${best.skill}', '${best.price}', '${best.photo_url}')" 
                            class="bg-indigo-600 text-white p-2 rounded-lg"><i class="fas fa-chevron-right"></i></button>
                </div>
            `;
        }
    } catch (err) {
        console.error("Recommendation error:", err);
    }
}

// Hire & Tracking
const statusFlow = ["Pending", "Accepted", "On the Way", "Reached", "Completed", "Paid"];

const customerStatusMeta = {
    "Pending": {
        title: "Finding your partner",
        subtitle: "Your request has been sent. Waiting for acceptance.",
        eta: "Usually responds in under 1 min"
    },
    "Accepted": {
        title: "Partner accepted",
        subtitle: "Your partner is getting ready and preparing to move.",
        eta: "Pickup prep started"
    },
    "On the Way": {
        title: "Partner is on the way",
        subtitle: "Live tracking is active. You can call your partner anytime.",
        eta: "Arriving shortly"
    },
    "Reached": {
        title: "Partner has arrived",
        subtitle: "Your partner is at the location. Work can begin now.",
        eta: "Reached your location"
    },
    "Completed": {
        title: "Work completed",
        subtitle: "Invoice has been sent to your email. Please complete payment.",
        eta: "Awaiting payment"
    },
    "Paid": {
        title: "Payment completed",
        subtitle: "Receipt has been sent to your email. Booking closed successfully.",
        eta: "All done"
    }
};

const partnerStatusMeta = {
    "Pending": {
        label: "Swipe to accept booking",
        helper: "New nearby request waiting for your approval"
    },
    "Accepted": {
        label: "Swipe to start trip",
        helper: "Head towards the customer location"
    },
    "On the Way": {
        label: "Swipe when you arrive",
        helper: "Keep the customer updated while travelling"
    },
    "Reached": {
        label: "Swipe to finish work",
        helper: "Complete the service and send the invoice"
    },
    "Completed": {
        label: "Waiting for customer payment",
        helper: "Invoice sent. Receipt will follow after payment."
    }
};

function renderCustomerActiveJob(job) {
    const container = document.getElementById('active-job-details');
    if (!container || !job) return;

    const meta = customerStatusMeta[job.status] || customerStatusMeta.Pending;
    const customerSteps = [
        { key: 'Pending', label: 'Request sent' },
        { key: 'Accepted', label: 'Accepted' },
        { key: 'On the Way', label: 'On the way' },
        { key: 'Reached', label: 'Reached' },
        { key: 'Completed', label: 'Work done' },
        { key: 'Paid', label: 'Paid' }
    ];

    container.innerHTML = `
        <div class="space-y-4">
            <div class="bg-slate-900 text-white rounded-[2rem] p-5 shadow-xl">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-indigo-200">Live booking</p>
                        <h3 class="text-2xl font-black mt-2">${meta.title}</h3>
                        <p class="text-sm text-slate-300 mt-2">${meta.subtitle}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">ETA</p>
                        <p class="text-sm font-black text-white mt-2">${meta.eta}</p>
                    </div>
                </div>
                <div class="mt-4 flex items-center justify-between bg-white/10 rounded-2xl px-4 py-3">
                    <div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-300">Service</p>
                        <p class="font-black text-lg">${job.skill || 'Service'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-300">Amount</p>
                        <p class="font-black text-lg">Rs.${parseFloat(job.price || 0).toFixed(2)}</p>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-[2rem] border border-slate-100 p-5 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Assigned partner</p>
                        <p class="text-lg font-black text-slate-800">${job.worker_name || 'Partner will be assigned'}</p>
                    </div>
                    <button onclick="window.location.href='tel:${job.worker_phone || ''}'" class="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-phone-alt"></i>
                    </button>
                </div>
                <div class="space-y-4">
                    ${customerSteps.map((step) => `
                        <div id="step-${step.key.toLowerCase().replace(/ /g, '') === 'ontheway' ? 'ontheway' : step.key.toLowerCase()}" class="flex items-start gap-3">
                            <div id="indicator-${step.key.toLowerCase().replace(/ /g, '') === 'ontheway' ? 'ontheway' : step.key.toLowerCase()}" class="w-3 h-3 bg-slate-300 rounded-full mt-1"></div>
                            <div>
                                <p class="font-bold text-slate-800">${step.label}</p>
                                <p id="time-${step.key.toLowerCase().replace(/ /g, '') === 'ontheway' ? 'ontheway' : step.key.toLowerCase()}" class="text-xs text-slate-400 font-medium">Waiting</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

async function updateJobStatusManual() {
    if (!activeJob) return;

    const currentIndex = statusFlow.indexOf(activeJob.status || "Accepted");
    if (currentIndex === -1 || currentIndex >= statusFlow.length - 1) return;

    const nextStatus = statusFlow[currentIndex + 1];

    try {
        const res = await fetch('/api/jobs/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: activeJob.id, status: nextStatus })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Status update failed");
        }

        activeJob.status = nextStatus;
        updateTrackingUI(nextStatus);

        if (data.mail && !data.mail.success) {
            showAppFeedback(`Status updated, but email sending failed: ${data.mail.error}`, 'error');
        } else if (nextStatus === "Completed") {
            showAppFeedback("Work finished. Bill PDF sent to the customer email.", 'success');
        } else if (nextStatus === "Paid") {
            setTimeout(() => {
                showAppFeedback("Payment successful. Receipt PDF sent to the customer email.", 'success');
                toggleTracking('partner', false);
                activeJob = null;
            }, 2000);
        }

        renderStatusActionButton();
    } catch (err) {
        console.error("Status update error:", err);
        showAppFeedback(err.message || "Status update failed", 'error');
    }
}

function renderStatusActionButton() {
    const btnContainer = document.getElementById('partner-action-container');
    if (!activeJob || !btnContainer) return;

    const currentIndex = statusFlow.indexOf(activeJob.status || "Accepted");
    if (currentIndex >= statusFlow.length - 1) {
        btnContainer.innerHTML = '';
        return;
    }

    const nextStatus = statusFlow[currentIndex + 1];
    let label = "";

    if (nextStatus === "Accepted") label = "Accept Job & Start Work";
    if (nextStatus === "On the Way") label = "Start Heading to Location";
    if (nextStatus === "Reached") label = "Mark as Reached";
    if (nextStatus === "Completed") label = "Finish Work & Send Bill";
    if (nextStatus === "Paid") label = "Mark as Paid & Send Receipt";

    btnContainer.innerHTML = `
        <div class="mt-8 relative h-16 bg-slate-100 rounded-2xl p-1 flex items-center group cursor-pointer overflow-hidden border border-slate-200" onclick="updateJobStatusManual()">
            <div class="absolute inset-0 bg-indigo-600 w-0 group-active:w-full transition-all duration-500 opacity-10"></div>
            <div class="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg z-10 transition-transform group-active:translate-x-[280px]">
                <i class="fas fa-chevron-right"></i>
            </div>
            <span class="flex-1 text-center font-bold text-slate-600 group-active:text-indigo-600 transition-colors">${label}</span>
        </div>
        <p class="text-[10px] text-center text-slate-400 mt-2 font-bold uppercase tracking-widest">Worker Action Required</p>
    `;
}

function setupMapTracking(start, end, photo_url) {
    if (trackingWorkerMarker) map.removeLayer(trackingWorkerMarker);
    if (trackingPath) map.removeLayer(trackingPath);

    trackingWorkerMarker = L.marker([start.lat, start.lng], {
        icon: L.divIcon({
            className: 'tracking-worker-icon',
            html: `<div class="w-12 h-12 bg-white rounded-2xl shadow-2xl border-2 border-indigo-600 overflow-hidden flex items-center justify-center animate-bounce">
                    <img src="${photo_url}" class="w-full h-full object-cover">
                   </div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
        })
    }).addTo(map);

    trackingPath = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], {
        color: '#4F46E5',
        weight: 4,
        dashArray: '10, 10',
        opacity: 0.5
    }).addTo(map);

    map.fitBounds(trackingPath.getBounds(), { padding: [100, 100] });
}

function hireWorker(id, name, skill, price, photo_url) {
    const email = localStorage.getItem('userEmail');
    if (!email) {
        openAuthModal();
        return;
    }
    setInlineMessage('booking-status', '');

    // Show booking modal instead of instant tracking
    document.getElementById('booking-name').innerText = name;
    document.getElementById('booking-skill').innerText = skill;
    document.getElementById('booking-price').innerText = `₹${price}`;
    document.getElementById('booking-photo').src = photo_url || 'https://via.placeholder.com/150';
    document.getElementById('booking-modal')?.classList.remove('hidden');
    if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'flex';

    fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            worker_id: id,
            customer_email: email,
            skill: skill,
            price: price,
            customer_location: {
                lat: userLocation.lat,
                lng: userLocation.lng
            }
        })
    })
    .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || 'Failed to send request');
        }
        return data;
    })
    .then(data => {
        activeJob = data.job;
        renderCustomerActiveJob(activeJob);
        updateTrackingUI(activeJob.status || 'Pending');
        setInlineMessage('booking-status', data.message || 'Request sent to partner successfully.', 'success');
        // Polling will handle closing the calling modal when status changes from Pending
        startStatusPolling();
    })
    .catch(err => {
        document.getElementById('booking-modal')?.classList.add('hidden');
        if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'none';
        setInlineMessage('booking-status', err.message || "Failed to initiate hiring", 'error');
    });
}

function requestNearbyPartners() {
    const email = localStorage.getItem('userEmail');
    if (!email) {
        openAuthModal();
        return;
    }

    const filteredWorkers = getFilteredWorkersList();
    if (filteredWorkers.length === 0) {
        setInlineMessage('booking-status', 'No nearby partners found for this filter.', 'error');
        return;
    }

    const primarySkill = currentFilter && currentFilter !== 'All'
        ? currentFilter
        : (filteredWorkers[0]?.skill || 'Service');

    document.getElementById('booking-name').innerText = `${filteredWorkers.length} nearby partners`;
    document.getElementById('booking-skill').innerText = primarySkill;
    document.getElementById('booking-price').innerText = `Broadcast request in progress`;
    document.getElementById('booking-photo').src = filteredWorkers[0]?.photo_url || 'https://via.placeholder.com/150';
    document.getElementById('booking-modal')?.classList.remove('hidden');
    if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'flex';

    fetch('/api/jobs/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer_email: email,
            skill: primarySkill,
            worker_ids: filteredWorkers.map((worker) => worker.id),
            price: filteredWorkers[0]?.price || 0,
            customer_location: {
                lat: userLocation.lat,
                lng: userLocation.lng
            }
        })
    })
    .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || 'Failed to send request');
        }
        return data;
    })
    .then((data) => {
        activeJob = data.job;
        renderCustomerActiveJob(activeJob);
        updateTrackingUI(activeJob.status || 'Pending');
        setInlineMessage('booking-status', data.message || 'Request sent to nearby partners.', 'success');
        startStatusPolling();
    })
    .catch((err) => {
        document.getElementById('booking-modal')?.classList.add('hidden');
        if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'none';
        setInlineMessage('booking-status', err.message || 'Failed to send nearby request', 'error');
    });
}

function cancelBooking() {
    if (activeJob) {
        fetch('/api/jobs/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: activeJob.id, cancelled_by: 'customer' })
        });
    }
    activeJob = null;
    document.getElementById('booking-modal')?.classList.add('hidden');
    if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'none';
    if (statusPollInterval) clearInterval(statusPollInterval);
}

async function rejectPartnerRequest(jobId) {
    try {
        const res = await fetch('/api/jobs/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to reject request');
        setInlineMessage('partner-status-banner', data.message || 'Request rejected', 'info');
        loadPartnerDashboard();
    } catch (err) {
        setInlineMessage('partner-status-banner', err.message || 'Failed to reject request', 'error');
    }
}

async function cancelPartnerJob(jobId) {
    try {
        const res = await fetch('/api/jobs/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId, cancelled_by: 'partner' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to cancel job');
        setInlineMessage('partner-status-banner', data.message || 'Job cancelled', 'info');
        loadPartnerDashboard();
    } catch (err) {
        setInlineMessage('partner-status-banner', err.message || 'Failed to cancel job', 'error');
    }
}

let statusPollInterval = null;
function startStatusPolling() {
    if (statusPollInterval) clearInterval(statusPollInterval);
    
    statusPollInterval = setInterval(async () => {
        if (!activeJob) {
            clearInterval(statusPollInterval);
            return;
        }

        try {
            const res = await fetch(`/api/jobs/customer/${localStorage.getItem('userEmail')}`);
            const jobs = await res.json();
            const previousStatus = activeJob.status;
            const current = jobs.find(j => j.id === activeJob.id) || selectCustomerActiveJob(jobs);
            
            if (current) {
                // Update worker location if we can find them
                fetch('/api/workers/')
                    .then(r => r.json())
                    .then(workers => {
                        const w = workers.find(worker => worker.id === current.worker_id);
                        if (w && trackingWorkerMarker) {
                            trackingWorkerMarker.setLatLng([w.lat, w.lng]);
                            if (trackingPath) trackingPath.setLatLngs([[w.lat, w.lng], [userLocation.lat, userLocation.lng]]);
                        }
                    });

                if (current.status !== previousStatus || current.id !== activeJob.id) {
                    activeJob = current;
                    renderCustomerActiveJob(activeJob);
                    updateTrackingUI(activeJob.status);
                    
                    if (activeJob.status !== 'Pending') {
                        document.getElementById('booking-modal')?.classList.add('hidden');
                        if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'none';
                        if (activeJob.status === 'Accepted') toggleTracking('user', true);
                    }

                    if (previousStatus === 'Pending' && activeJob.status === 'Rejected') {
                        setInlineMessage('booking-status', 'One partner rejected the request. Looking for another nearby partner.', 'info');
                    }

                    if (activeJob.status === "Paid") {
                        clearInterval(statusPollInterval);
                        activeJob = null;
                        location.reload(); // Refresh to clean state
                    }
                }
            } else {
                clearInterval(statusPollInterval);
                document.getElementById('booking-modal')?.classList.add('hidden');
                if (document.getElementById('booking-modal')) document.getElementById('booking-modal').style.display = 'none';
                if (previousStatus === 'Pending') {
                    setInlineMessage('booking-status', 'No nearby partner accepted the request. Please try again or change the filter.', 'error');
                }
                activeJob = null;
            }
        } catch (err) {
            console.log("Polling error");
        }
    }, 3000);
}

function updateTrackingUI(status) {
    const steps = {
        "Pending": { id: "step-pending", indicator: "indicator-pending", time: "time-pending" },
        "Accepted": { id: "step-accepted", indicator: "indicator-accepted", time: "time-accepted" },
        "On the Way": { id: "step-ontheway", indicator: "indicator-ontheway", time: "time-ontheway" },
        "Reached": { id: "step-reached", indicator: "indicator-reached", time: "time-reached" },
        "Completed": { id: "step-completed", indicator: "indicator-completed", time: "time-completed" },
        "Paid": { id: "step-paid", indicator: "indicator-paid", time: "time-paid" }
    };

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Reset all to dim
    Object.keys(steps).forEach(key => {
        const step = document.getElementById(steps[key].id);
        const ind = document.getElementById(steps[key].indicator);
        if (step) step.classList.add('opacity-40');
        if (ind) ind.className = "w-3 h-3 bg-slate-300 rounded-full";

        const pStep = document.getElementById('p-' + steps[key].id);
        const pInd = document.getElementById('p-' + steps[key].id.replace('step-', 'ind-'));
        if (pStep) pStep.classList.add('opacity-40');
        if (pInd) pInd.className = "w-3 h-3 bg-slate-300 rounded-full";
    });

    const statusList = Object.keys(steps);
    const currentIndex = statusList.indexOf(status);

    for (let i = 0; i <= currentIndex; i++) {
        const s = statusList[i];
        const stepEl = document.getElementById(steps[s].id);
        const indEl = document.getElementById(steps[s].indicator);
        const timeEl = document.getElementById(steps[s].time);

        // Partner UI indicators
        const pStepEl = document.getElementById('p-' + steps[s].id);
        const pIndEl = document.getElementById('p-' + steps[s].id.replace('step-', 'ind-'));

        if (stepEl) stepEl.classList.remove('opacity-40');
        if (pStepEl) pStepEl.classList.remove('opacity-40');
        
        if (i === currentIndex && status !== "Paid") {
            if (indEl) indEl.className = "step-pulse";
            if (pIndEl) pIndEl.className = "step-pulse";
            if (timeEl) timeEl.innerText = `In Progress • ${currentTime}`;
        } else {
            const finishedColor = "w-3 h-3 bg-indigo-600 rounded-full";
            if (indEl) indEl.className = finishedColor;
            if (pIndEl) pIndEl.className = finishedColor;
            
            if (timeEl && i < currentIndex) {
                 if (!timeEl.innerText.includes("Completed")) {
                    timeEl.innerText = `Finished • ${currentTime}`;
                 }
            }
        }
    }

    if (status === "Paid") {
        const paidColor = "w-3 h-3 bg-green-500 rounded-full";
        if (document.getElementById('indicator-paid')) document.getElementById('indicator-paid').className = paidColor + " ring-4 ring-green-100";
        if (document.getElementById('p-ind-completed')) document.getElementById('p-ind-completed').className = paidColor;
        if (document.getElementById('time-paid')) document.getElementById('time-paid').innerText = `Paid Successfully • ${currentTime}`;
    }
}

function refocusMap() {
    if (trackingPath) {
        map.fitBounds(trackingPath.getBounds(), { padding: [100, 100] });
    } else {
        map.setView([userLocation.lat, userLocation.lng], 14);
    }
}
function showFeature(name) {
    if (name === 'register') {
        const email = localStorage.getItem('userEmail');
        if (!email) {
            showAppFeedback("Please login first to register as a partner.", 'error');
            openAuthModal();
            return;
        }
        document.getElementById('register-modal')?.classList.remove('hidden');
    } else if (name === 'explore') {
        closeModal('partner-earnings-modal');
        closeModal('partner-history-modal');
        refocusMap();
    } else if (name === 'earnings') {
        renderPartnerEarnings();
        document.getElementById('partner-earnings-modal')?.classList.remove('hidden');
    } else if (name === 'history') {
        renderPartnerHistory();
        document.getElementById('partner-history-modal')?.classList.remove('hidden');
    } else if (name === 'settings') {
        openProfile();
    }
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function normalizeAppRole(role) {
    if (role === 'user') return 'customer';
    return role;
}

async function toggleTracking(role = 'user', forceOpen = null) {
    // Role enforcement
    const userRole = normalizeAppRole(localStorage.getItem('userRole'));
    const requestedRole = normalizeAppRole(role);
    if (userRole && userRole !== requestedRole) {
        showAppFeedback(`You are currently logged in as a ${userRole}. You cannot access ${requestedRole} features.`, 'error');
        return;
    }

    const panelId = requestedRole === 'customer' ? 'tracking-panel' : 'partner-panel';
    const panel = document.getElementById(panelId);
    if (!panel) return; // Safety check

    // Close other panel if open
    const otherRole = requestedRole === 'customer' ? 'partner' : 'customer';
    const otherPanel = document.getElementById(otherRole === 'customer' ? 'tracking-panel' : 'partner-panel');
    if (otherPanel && !otherPanel.classList.contains('hidden')) {
        otherPanel.classList.add('translate-x-full');
        setTimeout(() => otherPanel.classList.add('hidden'), 500);
    }

    const isOpen = !panel.classList.contains('hidden');

    if (forceOpen === true || (!isOpen && forceOpen === null)) {
        panel.classList.remove('hidden');
        setTimeout(() => panel.classList.remove('translate-x-full'), 10);

        if (requestedRole === 'customer') {
            const titleEl = document.getElementById('tracking-panel-title');
            if (activeJob) {
                if (titleEl) titleEl.innerText = "Live Status";
                document.getElementById('active-job-details')?.classList.remove('hidden');
                document.getElementById('no-active-job')?.classList.add('hidden');
            } else {
                if (titleEl) titleEl.innerText = "Request History";
                await loadJobHistory();
            }
        } else {
            await loadPartnerDashboard();
        }
    } else {
        panel.classList.add('translate-x-full');
        setTimeout(() => panel.classList.add('hidden'), 500);
    }
}

async function loadPartnerDashboard() {
    const workerId = localStorage.getItem('workerId');
    if (!workerId) return;

    try {
        const res = await fetch(`/api/jobs/worker/${workerId}`);
        const jobs = await res.json();
        partnerJobsCache = jobs;
        
        const active = selectPartnerDashboardJob(jobs);
        const waitingView = document.getElementById('partner-waiting-view');
        const activeView = document.getElementById('partner-active-job-details');

        // Update earnings (mocking for now, could be dynamic)
        const earned = jobs.filter(j => j.status === 'Paid').reduce((sum, j) => sum + parseFloat(j.price), 0);
        const earningsTitle = document.querySelector('#partner-mode-ui h3.text-slate-800');
        if (earningsTitle) earningsTitle.innerText = `₹${earned.toFixed(2)}`;
        const earningsValue = document.getElementById('partner-earnings');
        if (earningsValue) earningsValue.innerText = `₹${earned.toFixed(2)}`;
        if (active) {
            activeJob = active;
            waitingView?.classList.add('hidden');
            activeView?.classList.remove('hidden');

            const partnerStatus = partnerStatusMeta[active.status] || partnerStatusMeta.Pending;

            if (activeView) { // Safety check
                activeView.innerHTML = `
                    <!-- Partner Active Job Card -->
                    <div class="fixed top-[180px] left-[15px] right-[15px] z-[100]">
                        <div class="bg-indigo-600 p-6 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                            <div class="relative z-10">
                                <div class="flex items-center gap-4 mb-6">
                                    <div class="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-white text-2xl backdrop-blur-md">
                                        <i class="fas fa-user border-white/20"></i>
                                    </div>
                                    <div class="flex-1">
                                        <h4 class="text-white font-black text-lg">${active.customer_name || active.customer_email.split('@')[0]}</h4>
                                        <p class="text-indigo-200 text-[10px] font-bold uppercase tracking-widest">${active.skill}</p>
                                        <p class="text-white/80 text-xs font-bold mt-2">${partnerStatus.helper}</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-[9px] text-white/50 font-black uppercase tracking-widest">Payout</p>
                                        <p class="text-white font-black text-xl">₹${active.price}</p>
                                    </div>
                                </div>
                                
                                <div class="flex justify-between items-center mb-0">
                                    <div>
                                        <p class="text-[9px] text-white/50 font-black uppercase tracking-widest leading-none">Status</p>
                                        <p class="text-indigo-200 font-black text-[11px] uppercase mt-1 tracking-wider">${active.status}</p>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        ${active.status === 'Pending' ? `
                                        <button onclick="rejectPartnerRequest('${active.id}')" class="w-10 h-10 bg-rose-500/80 rounded-xl flex items-center justify-center text-white backdrop-blur-md">
                                            <i class="fas fa-times"></i>
                                        </button>
                                        ` : `
                                        <button onclick="cancelPartnerJob('${active.id}')" class="w-10 h-10 bg-rose-500/80 rounded-xl flex items-center justify-center text-white backdrop-blur-md">
                                            <i class="fas fa-ban"></i>
                                        </button>
                                        `}
                                        <button onclick="openPartnerDirections(${active.customer_location?.lat ?? 'null'}, ${active.customer_location?.lng ?? 'null'})" class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white backdrop-blur-md">
                                            <i class="fas fa-route"></i>
                                        </button>
                                        <button onclick="window.location.href='tel:${active.customer_phone || '00'}'" class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white backdrop-blur-md">
                                            <i class="fas fa-phone-alt"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="absolute -right-8 -bottom-8 w-40 h-40 bg-white/5 rounded-full pointer-events-none"></div>
                        </div>
                    </div>

                    <!-- Swipe Action Component -->
                    ${active.status !== 'Completed' ? `
                        <div id="swipe-btn-${active.id}" class="swipe-container">
                            <div class="swipe-handle">
                                <i class="fas fa-chevron-right"></i>
                            </div>
                            <div class="swipe-text">${partnerStatus.label}</div>
                        </div>
                    ` : `
                        <div class="fixed bottom-[105px] left-[15px] right-[15px] bg-emerald-500 text-white p-5 rounded-[2rem] text-center shadow-xl z-[100]">
                            <p class="font-black uppercase tracking-widest text-xs">Waiting for customer to pay</p>
                        </div>
                    `}
                `;
            }
            
            if (active.status !== 'Completed') {
                setTimeout(() => initSwipeButton(active.id, active.status), 50);
            }

            // Map sync
            if (map) {
                const custLoc = active.customer_location || { lat: userLocation.lat + 0.002, lng: userLocation.lng + 0.002 };
                if (trackingUserMarker) {
                    trackingUserMarker.setLatLng([custLoc.lat, custLoc.lng]).bindPopup("Customer is precisely here").openPopup();
                    map.setView([custLoc.lat, custLoc.lng], 16);
                }
                setupMapTracking(userLocation, custLoc, 'https://cdn-icons-png.flaticon.com/512/1946/1946429.png');
            }

            // Ringing
            const ring = document.getElementById('ring-sound');
            if (active.status === 'Pending') {
                if (ring && ring.paused) ring.play().catch(e => console.log("Sound blocked"));
            } else {
                if (ring && !ring.paused) { ring.pause(); ring.currentTime = 0; }
            }
        } else {
            waitingView?.classList.remove('hidden');
            activeView?.classList.add('hidden');
            const ring = document.getElementById('ring-sound');
            if (ring && !ring.paused) { ring.pause(); ring.currentTime = 0; }
        }
    } catch (err) {
        console.log("Partner dashboard load error", err);
    }
}

async function updateJobStatus(jobId, status) {
    try {
        const res = await fetch('/api/jobs/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId, status: status })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Status update failed");
        }
        if (data.mail && !data.mail.success) {
            showAppFeedback(`Status updated, but email sending failed: ${data.mail.error}`, 'error');
        }
        loadPartnerDashboard();
    } catch (err) { showAppFeedback(err.message || "Status update failed", 'error'); }
}

function openPartnerDirections(lat, lng) {
    const safeLat = Number(lat);
    const safeLng = Number(lng);

    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
        showAppFeedback("Customer location is not available yet.", 'error');
        return;
    }

    window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${safeLat},${safeLng}&travelmode=driving`,
        '_blank',
        'noopener'
    );
}

function renderPartnerEarnings() {
    const totalEl = document.getElementById('partner-earnings-total');
    const paidJobsEl = document.getElementById('partner-paid-jobs');
    const pendingJobsEl = document.getElementById('partner-pending-jobs');

    const paidJobs = partnerJobsCache.filter((job) => job.status === 'Paid');
    const pendingJobs = partnerJobsCache.filter((job) => job.status !== 'Paid');
    const total = paidJobs.reduce((sum, job) => sum + parseFloat(job.price || 0), 0);

    if (totalEl) totalEl.innerText = `₹${total.toFixed(2)}`;
    if (paidJobsEl) paidJobsEl.innerText = `${paidJobs.length}`;
    if (pendingJobsEl) pendingJobsEl.innerText = `${pendingJobs.length}`;
}

function renderPartnerHistory() {
    const list = document.getElementById('partner-history-list');
    const empty = document.getElementById('partner-history-empty');
    if (!list || !empty) return;

    if (partnerJobsCache.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = partnerJobsCache.map((job) => `
        <div class="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div>
                    <p class="font-black text-slate-800">${job.customer_name || job.customer_email?.split('@')[0] || 'Customer'}</p>
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">${job.skill}</p>
                </div>
                <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${job.status === 'Paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}">
                    ${job.status}
                </span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500">${new Date(job.created_at).toLocaleString()}</span>
                <span class="font-black text-slate-800">₹${parseFloat(job.price || 0).toFixed(2)}</span>
            </div>
        </div>
    `).join('');
}

function initSwipeButton(jobId, currentStatus) {
    const container = document.getElementById('swipe-btn-' + jobId);
    if (!container || container.dataset.init) return;
    container.dataset.init = "true";

    const handle = container.querySelector('.swipe-handle');
    if (!handle) return; // Safety check
    const maxTrack = container.offsetWidth - handle.offsetWidth - 8;
    let startX = 0;
    let isDragging = false;

    const nextStatusMap = {
        'Pending': 'Accepted',
        'Accepted': 'On the Way',
        'On the Way': 'Reached',
        'Reached': 'Completed'
    };

    const onStart = (e) => {
        startX = (e.type === 'mousedown') ? e.pageX : e.touches[0].pageX;
        isDragging = true;
        handle.style.transition = 'none';
        container.style.cursor = 'grabbing';
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = (e.type === 'mousemove') ? e.pageX : e.touches[0].pageX;
        let moveX = currentX - startX;
        if (moveX < 0) moveX = 0;
        if (moveX > maxTrack) moveX = maxTrack;
        handle.style.transform = `translateX(${moveX}px)`;
        
        if (moveX >= maxTrack) {
            onEnd(true);
        }
    };

    const onEnd = (success = false) => {
        if (!isDragging) return;
        isDragging = false;
        container.style.cursor = 'pointer';
        handle.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        
        if (success) {
            handle.style.transform = `translateX(${maxTrack}px)`;
            handle.style.background = '#10b981';
            handle.innerHTML = '<i class="fas fa-check"></i>';
            updateJobStatus(jobId, nextStatusMap[currentStatus]);
        } else {
            handle.style.transform = 'translateX(0px)';
        }
    };

    container.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', () => onEnd(false));

    container.addEventListener('touchstart', onStart);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', () => onEnd(false));
}

function switchRole(mode) {
    const partnerUI = document.getElementById('partner-mode-ui');
    const partnerBtn = document.getElementById('nav-partner-btn');
    
    if (mode === 'partner') {
        const workerId = localStorage.getItem('workerId');
        if (!workerId) {
             showAppFeedback("Please register as a partner first.", 'error');
             return;
        }
        partnerUI?.classList.remove('hidden');
        loadPartnerDashboard();
        if (partnerBtn) {
            partnerBtn.innerText = "Partner Desk";
            partnerBtn.onclick = () => switchRole('partner');
        }
    } else {
        const userRole = localStorage.getItem('userRole');
        if (userRole === 'partner') {
            showAppFeedback("You are registered as a Partner. Please use the Partner Desk.", 'info');
            switchRole('partner');
            return;
        }
        partnerUI?.classList.add('hidden');
        if (partnerBtn) {
            partnerBtn.innerText = "Partner Desk";
            partnerBtn.onclick = () => switchRole('partner');
        }
    }
    localStorage.setItem('lastAppMode', mode);
}

async function loadJobHistory() {
    const email = localStorage.getItem('userEmail');
    if (!email) return;

    document.getElementById('active-job-details')?.classList.add('hidden');
    document.getElementById('no-active-job')?.classList.remove('hidden');

    try {
        const res = await fetch(`/api/jobs/customer/${email}`);
        const jobs = await res.json();

        const list = document.getElementById('job-history-list');
        const empty = document.getElementById('empty-history');

        if (jobs.length === 0) {
            if (list) list.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }

        empty?.classList.add('hidden');
        if (list) {
            list.innerHTML = jobs.map(job => `
                <div class="glass p-4 rounded-2xl border border-white/50 mb-3">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <p class="font-bold text-slate-800">${job.skill}</p>
                            <p class="text-[10px] text-slate-500 uppercase font-black">${new Date(job.created_at).toLocaleDateString()}</p>
                        </div>
                        <span class="px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                            job.status === 'Paid' ? 'bg-green-100 text-green-600' :
                            job.status === 'Cancelled' ? 'bg-rose-100 text-rose-600' :
                            job.status === 'Rejected' ? 'bg-slate-200 text-slate-700' :
                            job.status === 'Expired' ? 'bg-slate-100 text-slate-500' :
                            'bg-indigo-100 text-indigo-600'
                }">${job.status}</span>
                    </div>
                    <div class="flex justify-between items-center text-sm">
                        <span class="text-slate-500">Price</span>
                        <span class="font-bold text-slate-800">₹${job.price}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("History load error:", err);
    }
}

function setFilter(skill) {
    currentFilter = skill;
    renderMarkers(workersCache);
}

function filterWorkers() {
    const skillSearch = document.getElementById('skillSearch');
    const val = skillSearch ? skillSearch.value : '';
    currentFilter = val || 'All';
    renderMarkers(workersCache);
}

// Auth flow
function openAuthModal() {
    setInlineMessage('auth-status', '');
    setOtpPreview('');
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('hidden');
    else {
        if (window.location.pathname !== '/') {
            setInlineMessage('auth-status', 'Please login from the main page.', 'error');
            window.location.href = '/';
        }
    }
}

async function requestOTP() {
    const authEmail = document.getElementById('auth-email');
    const email = authEmail ? authEmail.value.trim().toLowerCase() : '';
    if (!email) {
        setInlineMessage('auth-status', 'Email is required.', 'error');
        return;
    }
    setOtpPreview('');
    setInlineMessage('auth-status', 'Sending OTP...', 'info');

    try {
        const res = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            if (data.delivery === 'fallback' && data.otp_preview) {
                setInlineMessage('auth-status', data.message || 'Use the OTP shown below to continue.', 'info');
                setOtpPreview(data.otp_preview);
            } else {
                setInlineMessage('auth-status', 'OTP sent successfully. Check your inbox.', 'success');
            }
            document.getElementById('otp-request')?.classList.add('hidden');
            document.getElementById('otp-verify')?.classList.remove('hidden');
        } else {
            const rawError = data.error || "Error sending OTP";
            const friendlyError = rawError.toLowerCase().includes('smtp')
                ? 'Login is temporarily unavailable. Admin must configure email settings on the server.'
                : rawError;
            setInlineMessage('auth-status', friendlyError, 'error');
        }
    } catch (err) {
        setInlineMessage('auth-status', 'Server error. Please try again.', 'error');
    }
}

async function verifyOTP() {
    const authEmail = document.getElementById('auth-email');
    const authOtp = document.getElementById('auth-otp');
    const email = authEmail ? authEmail.value.trim().toLowerCase() : '';
    const otp = authOtp ? authOtp.value.trim() : '';
    if (!email || !otp) {
        setInlineMessage('auth-status', 'Enter email and OTP.', 'error');
        return;
    }
    setInlineMessage('auth-status', 'Verifying OTP...', 'info');

    try {
        const res = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, otp: otp })
        });
        const data = await res.json();
        if (data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('userEmail', data.email);
            if (data.role) localStorage.setItem('userRole', data.role);
            if (data.user?.id && data.role === 'partner') {
                localStorage.setItem('workerId', data.user.id);
            }
            
            if (data.has_profile) {
                if (data.role === 'partner') {
                    localStorage.setItem('userRole', 'partner');
                    window.location.href = '/partner';
                } else {
                    localStorage.setItem('userRole', 'customer');
                    window.location.href = '/customer';
                }
            } else {
                document.getElementById('auth-modal')?.classList.add('hidden');
                document.getElementById('role-choice-modal')?.classList.remove('hidden');
            }
        } else {
            setInlineMessage('auth-status', data.error || "Invalid OTP", 'error');
        }
    } catch (err) {
        setInlineMessage('auth-status', 'Authentication failed. Please try again.', 'error');
    }
}

function selectInitialRole(role) {
    document.getElementById('role-choice-modal')?.classList.add('hidden');
    if (role === 'user') {
        document.getElementById('customer-register-modal')?.classList.remove('hidden');
    } else {
        document.getElementById('register-modal')?.classList.remove('hidden');
    }
}

document.getElementById('customer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    data.email = localStorage.getItem('userEmail');

    try {
        const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            localStorage.setItem('userRole', 'customer');
            showAppFeedback("Account created successfully!", 'success');
            window.location.href = '/customer';
        } else {
            const err = await res.json();
            showAppFeedback(err.error || "Failed to create profile", 'error');
        }
    } catch (err) {
        showAppFeedback("Server error", 'error');
    }
});


// Handle registration form
document.getElementById('worker-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn?.innerText;
    
    // Show locating status
    submitBtn.disabled = true;
    submitBtn.innerText = "Locating you...";

    if (!navigator.geolocation) {
        showAppFeedback("Geolocation is not supported by your browser", 'error');
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        const formData = new FormData(e.target);
        formData.append('lat', lat);
        formData.append('lng', lng);
        formData.append('email', localStorage.getItem('userEmail'));

        try {
            const res = await fetch('/api/workers/register', {
                method: 'POST',
                body: formData
            });
            const result = await res.clone().json().catch(() => ({}));
            if (res.ok) {
                localStorage.setItem('userRole', 'partner');
                if (result.worker?.id) {
                    localStorage.setItem('workerId', result.worker.id);
                }
                showAppFeedback("Successfully registered as Partner at your current location!", 'success');
                localStorage.setItem('lastAppMode', 'partner');
                window.location.href = '/partner';
            } else {
                const errData = await res.json();
                showAppFeedback(errData.error || "Registration failed", 'error');
            }
        } catch (err) {
            showAppFeedback("Registration failed", 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    }, (err) => {
        showAppFeedback("Please enable location access to register as a partner.", 'error');
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }, { enableHighAccuracy: true });
});

// Start checking auth status
window.addEventListener('load', async () => {
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) {
        installBtn.addEventListener('click', promptInstallApp);
        updateInstallButton();
    }

    const hasMap = Boolean(document.getElementById('map'));
    if (hasMap) {
        initMap();
    }

    const email = localStorage.getItem('userEmail');
    const role = localStorage.getItem('userRole');
    if (email && role === 'partner' && !localStorage.getItem('workerId')) {
        try {
            const profileRes = await fetch(`/api/auth/profile/${email}`);
            if (profileRes.ok) {
                const profile = await profileRes.json();
                if (profile.id) {
                    localStorage.setItem('workerId', profile.id);
                }
            }
        } catch (err) {
            console.log('Partner profile bootstrap failed', err);
        }
    }
    if (email) {
        // Authenticated Navbar
        const authSection = document.getElementById('auth-section');
        if (authSection) {
            authSection.innerHTML = `
                <div class="flex items-center gap-2">
                    <div onclick="openProfile()" class="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-1.5 cursor-pointer hover:bg-indigo-100 transition flex items-center gap-2">
                        <div class="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                            ${email.charAt(0).toUpperCase()}
                        </div>
                        <span class="text-indigo-600 font-bold text-sm hidden lg:block">${email.split('@')[0]}</span>
                    </div>
                    <button onclick="logout()" class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800 hover:bg-slate-200 transition">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
            `;
        }

        // Role-based UI visibility
        const userRole = localStorage.getItem('userRole');
        const pBtn = document.getElementById('nav-partner-btn');
        const rBtn = document.getElementById('nav-register-btn');
        const mPBtn = document.getElementById('mobile-partner-btn');
        const mRBtn = document.querySelector('div[onclick="showFeature(\'register\')"]');

        if (userRole === 'partner') {
            if (pBtn) pBtn.classList.remove('hidden');
            if (rBtn) rBtn.classList.add('hidden');
            if (mPBtn) mPBtn.classList.remove('hidden');
            if (mRBtn) mRBtn.classList.add('hidden');
            
            // Auto switch to partner mode if partner
            switchRole('partner');
            loadPartnerDashboard();
        } else {
            if (pBtn) pBtn.classList.add('hidden');
            if (rBtn) rBtn.classList.remove('hidden');
            if (mPBtn) mPBtn.classList.add('hidden');
            if (mRBtn) mRBtn.classList.remove('hidden');

            // Resume Active Job (only for user role)
            fetch(`/api/jobs/customer/${email}`)
                .then(res => res.json())
                .then(jobs => {
                    const active = selectCustomerActiveJob(jobs);
                    if (active) {
                        activeJob = active;
                        renderCustomerActiveJob(activeJob);
                        updateTrackingUI(activeJob.status);
                        startStatusPolling();
                        toggleTracking('user', true);
                    }
                });
        }
    }

    // Register Service Worker
    if (hasMap) {
        detectLocation();
        loadWorkers();
    }
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW registration failed', err));
    }
});

function logout() {
    localStorage.clear();
    window.location.href = '/';
}

function resetAuth() {
    document.getElementById('otp-request').classList.remove('hidden');
    document.getElementById('otp-verify').classList.add('hidden');
}

async function openProfile(targetEmail = null) {
    const email = targetEmail || localStorage.getItem('userEmail');
    if (!email) return openAuthModal();

    const isViewingOther = targetEmail !== null && targetEmail !== localStorage.getItem('userEmail');

    try {
        const res = await fetch(`/api/auth/profile/${email}`);
        const data = await res.json();

        const profileEmail = document.getElementById('profile-email');
        const profileInitials = document.getElementById('profile-initials');
        const profileName = document.getElementById('profile-name');
        const badge = document.getElementById('worker-badge');
        const details = document.getElementById('worker-details');
        const prompt = document.getElementById('register-worker-prompt');

        if (profileEmail) profileEmail.innerText = email;
        if (profileInitials) profileInitials.innerText = (data.name || email).charAt(0).toUpperCase();

        if (data.is_partner) {
            if (badge) {
                badge.innerText = "Active Partner";
                badge.className = "px-3 py-1 bg-green-100 text-green-600 rounded-lg text-[10px] font-black uppercase";
            }
            if (details) details.classList.remove('hidden');
            
            if (profileName) profileName.innerText = data.name;
            const profileSkill = document.getElementById('profile-skill');
            const profilePrice = document.getElementById('profile-price');
            const profileRating = document.getElementById('profile-rating');
            const profileExperience = document.getElementById('profile-experience');
            const profileBio = document.getElementById('profile-bio');
            
            if (profileSkill) profileSkill.innerText = data.skill;
            if (profilePrice) profilePrice.innerText = `₹${data.price}/hr`;
            if (profileRating) profileRating.innerText = `${data.rating || 5.0} ★`;
            if (profileExperience) profileExperience.innerText = data.experience || '0';
            if (profileBio) profileBio.innerText = data.bio || 'No bio provided.';

            if (prompt) {
                if (isViewingOther) {
                    prompt.classList.add('hidden');
                } else {
                    prompt.innerText = "Go to Partner Desk";
                    prompt.onclick = () => { closeModal('profile-modal'); window.location.href='/partner'; };
                    prompt.classList.remove('hidden');
                    prompt.className = "w-full mt-4 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-sm hover:bg-indigo-700 transition shadow-xl shadow-indigo-100";
                }
            }
        } else {
            if (badge) {
                badge.innerText = "Customer";
                badge.className = "px-3 py-1 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black uppercase";
            }
            if (details) details.classList.add('hidden');
            if (profileName) profileName.innerText = data.name || email.split('@')[0];
            
            if (prompt && !isViewingOther) {
                prompt.innerText = "Register as Partner";
                prompt.onclick = () => { closeModal('profile-modal'); window.location.href='/'; /* Should trigger register modal logic maybe? Or just go to landing */ };
                prompt.classList.remove('hidden');
                prompt.className = "w-full mt-4 py-4 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-slate-800 transition";
            } else if (prompt) {
                prompt.classList.add('hidden');
            }
        }

        const modal = document.getElementById('profile-modal');
        if (modal) modal.classList.remove('hidden');
    } catch (err) {
        console.error("Profile error:", err);
    }
}

function quickRequest(id) {
    requestNearbyPartners();
}

// === NEW ADMIN & PARTNER ENHANCEMENTS ===
async function toggleAdmin(show) {
    const ui = document.getElementById('admin-dashboard-ui');
    if (show) {
        ui.classList.remove('hidden');
        await loadAdminStats();
        showAdminTab('partners');
    } else {
        ui.classList.add('hidden');
    }
}

async function loadAdminStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();
        document.getElementById('admin-total-users').innerText = stats.total_users;
        document.getElementById('admin-total-workers').innerText = stats.total_workers;
        document.getElementById('admin-total-jobs').innerText = stats.total_jobs;
        document.getElementById('admin-total-earnings').innerText = `₹${stats.total_earnings.toLocaleString()}`;
    } catch (e) { console.error("Admin stats error", e); }
}

async function showAdminTab(tab) {
    const head = document.getElementById('admin-table-head');
    const body = document.getElementById('admin-table-body');
    const tabs = ['partners', 'users', 'jobs'];
    
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.className = "px-6 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white shadow-lg shadow-indigo-100";
        } else {
            btn.className = "px-6 py-2 rounded-xl font-bold text-sm bg-white text-slate-600 hover:bg-slate-100 transition";
        }
    });

    // Clear previous state
    head.innerHTML = '';
    body.innerHTML = '<tr><td colspan="6" class="p-20 text-center"><i class="fas fa-circle-notch animate-spin text-indigo-600 text-3xl"></i></td></tr>';

    try {
        const res = await fetch(`/api/admin/${tab}`);
        if (!res.ok) throw new Error("Fetch failed");
        const data = await res.json();
        body.innerHTML = ''; // Clear spinner

        if (tab === 'partners') {
            head.innerHTML = `<tr>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Partner Details</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Skill</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Experience</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Actions</th>
            </tr>`;
            body.innerHTML = data.map(w => `
                <tr class="hover:bg-slate-50 transition border-b border-slate-50">
                    <td class="px-6 py-4 flex items-center gap-3">
                        <div class="relative">
                            <img src="${w.photo_url}" class="w-10 h-10 rounded-xl object-cover shadow-sm">
                            <div class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${w.status === 'Available' ? 'bg-green-500' : 'bg-slate-400'}"></div>
                        </div>
                        <div><p class="font-black text-slate-800">${w.name}</p><p class="text-[10px] text-slate-400 font-bold">${w.email}</p></div>
                    </td>
                    <td class="px-6 py-4">
                        <span class="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest">${w.skill}</span>
                    </td>
                    <td class="px-6 py-4">
                         <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Experience</p>
                         <p class="text-xs font-bold text-slate-700">${w.experience || 0} Years</p>
                    </td>
                    <td class="px-6 py-4 flex items-center gap-4">
                        <button onclick="viewWorkerProfile('${w.id}', '${w.email}')" class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all"><i class="fas fa-eye text-xs"></i></button>
                        <button onclick="deleteAdminItem('worker', '${w.id}')" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"><i class="fas fa-trash-alt text-xs"></i></button>
                    </td>
                </tr>
            `).join('');
        } else if (tab === 'users') {
            head.innerHTML = `<tr>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">User Account</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Phone Number</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Registration</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Actions</th>
            </tr>`;
            body.innerHTML = data.map(u => `
                <tr class="hover:bg-slate-50 transition border-b border-slate-50">
                    <td class="px-6 py-4"><div><p class="font-black text-slate-800">${u.name || 'Incognito User'}</p><p class="text-[10px] text-slate-400 font-bold">${u.email}</p></div></td>
                    <td class="px-6 py-4 font-bold text-slate-600 text-xs">${u.phone || '<span class="text-rose-300">Not Verified</span>'}</td>
                    <td class="px-6 py-4"><p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Joined</p><p class="text-[11px] font-bold text-slate-700">${new Date(u.created_at).toLocaleDateString()}</p></td>
                    <td class="px-6 py-4 flex items-center gap-4">
                        <button onclick="openProfile('${u.email}')" class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all"><i class="fas fa-user-shield text-xs"></i></button>
                        <button onclick="deleteAdminItem('user', '${u.id}')" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"><i class="fas fa-trash-alt text-xs"></i></button>
                    </td>
                </tr>
            `).join('');
        } else if (tab === 'jobs') {
            head.innerHTML = `<tr>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Work Reference</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Customer</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Assigned Partner</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Dispatch</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Payout</th>
                <th class="px-6 py-4 font-bold text-slate-400 uppercase text-[10px]">Process Status</th>
            </tr>`;
            body.innerHTML = data.map(j => `
                <tr class="hover:bg-slate-50 transition border-b border-slate-50">
                    <td class="px-6 py-4"><div><p class="font-black text-slate-800">${j.skill}</p><p class="text-[10px] text-slate-400 font-mono">#${j.id.split('-')[0]}</p></div></td>
                    <td class="px-6 py-4 text-slate-500 text-[11px] font-bold">${j.customer_email}</td>
                    <td class="px-6 py-4 text-slate-500 text-[11px] font-bold">${j.worker_email || '<span class="text-amber-500 italic">Waiting...</span>'}</td>
                    <td class="px-6 py-4">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">${j.request_mode || 'direct'}</p>
                        <p class="text-[11px] font-bold text-slate-700">${j.cancelled_by ? `Cancelled by ${j.cancelled_by}` : (j.rejected_by ? `Rejected by ${j.rejected_by}` : 'Live flow')}</p>
                    </td>
                    <td class="px-6 py-4 font-black text-indigo-600">₹${j.price}</td>
                    <td class="px-6 py-4">
                        <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            j.status === 'Paid' ? 'bg-emerald-100 text-emerald-600' :
                            j.status === 'Cancelled' ? 'bg-rose-100 text-rose-600 border border-rose-200' :
                            j.status === 'Rejected' ? 'bg-slate-200 text-slate-700 border border-slate-300' :
                            j.status === 'Expired' ? 'bg-slate-100 text-slate-500 border border-slate-200' :
                            'bg-amber-100 text-amber-600 border border-amber-200'
                        }">
                            ${j.status}
                        </span>
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) { 
        console.error("Tab data error", e); 
        body.innerHTML = '<tr><td colspan="6" class="p-20 text-center text-rose-500 font-bold">Failed to load system data. Please try again.</td></tr>';
    }
}
async function deleteAdminItem(type, id) {
    if (!confirm(`Delete this ${type}?`)) return;
    try {
        const res = await fetch(`/api/admin/delete-${type}/${id}`, { method: 'DELETE' });
        if (res.ok) { loadAdminStats(); showAdminTab(type === 'worker' ? 'partners' : 'users'); }
    } catch (e) { showAppFeedback("Action failed", 'error'); }
}

// partnerOnline is now declared at the top of the file
function togglePartnerOnlineStatus() {
    const btn = document.getElementById('partner-status-toggle');
    const dot = document.getElementById('partner-status-dot');
    const text = document.getElementById('partner-status-text');

    if (!btn || !text || !dot) return;

    partnerOnline = !partnerOnline;

    if (partnerOnline) {
        btn.innerText = "Go Offline";
        btn.className = "bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl font-bold text-xs ring-4 ring-indigo-50";
        dot.className = "w-2 h-2 rounded-full bg-green-500 animate-pulse";
        text.innerText = "Online & Ready";
        text.className = "text-xs font-bold text-green-600 uppercase";
    } else {
        btn.innerText = "Go Online";
        btn.className = "bg-slate-800 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-lg shadow-slate-200";
        dot.className = "w-2 h-2 rounded-full bg-slate-300";
        text.innerText = "Offline (Resting)";
        text.className = "text-xs font-bold text-slate-400 uppercase";
    }

    fetch('/api/workers/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: localStorage.getItem('userEmail'),
            availability: partnerOnline ? 'Available' : 'Offline'
        })
    }).catch(() => console.log('Availability update failed'));
}

// MANDATORY HIGH-ACCURACY GPS TRACKING FOR PARTNERS
setInterval(() => {
    const isPartner = localStorage.getItem('lastAppMode') === 'partner';
    if (isPartner && partnerOnline && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            fetch('/api/workers/register', { // Re-using register for update for simplicity
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    email: localStorage.getItem('userEmail'),
                    lat: latitude,
                    lng: longitude,
                    availability: partnerOnline ? 'Available' : 'Offline',
                    update_only: 'true'
                })
            });
        }, null, { enableHighAccuracy: true });
    }
}, 10000); // Every 10 seconds

// Admin Entry Logic
setTimeout(() => {
    const email = localStorage.getItem('userEmail');
    if (email && (email.includes('admin') || email === 'aryan@example.com')) {
        document.getElementById('admin-entrance-btn')?.classList.remove('hidden');
    }
}, 1000);

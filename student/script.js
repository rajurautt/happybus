
const API_KEY = window.CONFIG ? window.CONFIG.API_KEY : '';
const SHEET_ID = window.CONFIG ? window.CONFIG.SHEET_ID : '';
const APPS_SCRIPT_URL = window.CONFIG ? window.CONFIG.APPS_SCRIPT_URL : '';

// Global Variables
let currentStudent = null;
let buses = [];
let liveLocations = [];
let userLocation = null;
let currentBusTracking = null;
let isUpdating = false;
let popupTimeout = null;

// Utility function to fetch sheet data
async function getSheet(sheetName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}?key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.values || [];
    } catch (error) {
        console.error('Error fetching sheet:', error);
        return [];
    }
}

// Get user's location
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by this browser.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                userLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                resolve(userLocation);
            },
            error => {
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    });
}

// Convert coordinates to location name using reverse geocoding
async function getLocationName(lat, lng) {
    try {
        const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const components = result.address_components;
            let locationParts = [];
            
            const establishment = components.find(c => c.types.includes('establishment') || c.types.includes('point_of_interest'));
            if (establishment) locationParts.push(establishment.long_name);
            
            const route = components.find(c => c.types.includes('route'));
            if (route && (!establishment || !establishment.long_name.includes(route.short_name))) {
                locationParts.push(route.short_name);
            }
            
            const locality = components.find(c => c.types.includes('sublocality') || c.types.includes('locality'));
            if (locality && !locationParts.some(part => part.includes(locality.short_name))) {
                locationParts.push(locality.short_name);
            }
            
            if (locationParts.length > 0) {
                return locationParts.join(', ');
            } else {
                const formatted = result.formatted_address;
                const parts = formatted.split(',');
                return parts.length > 2 ? parts.slice(0, 2).join(',').trim() : formatted;
            }
        }
        
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        console.error('Error getting location name:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// Calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
}

// Calculate estimated time of arrival
function calculateETA(distance, speed) {
    if (!speed || speed === 0) return 'Unknown';
    const hours = distance / speed;
    const minutes = Math.round(hours * 60);
    
    if (minutes < 60) {
        return `${minutes} minutes`;
    } else {
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hrs}h ${mins}m`;
    }
}

// Calculate route progress percentage
function calculateRouteProgress(startLat, startLng, endLat, endLng, currentLat, currentLng) {
    if (!startLat || !startLng || !endLat || !endLng || !currentLat || !currentLng) {
        return { progress: 0, completed: false };
    }
    
    const totalDistance = calculateDistance(startLat, startLng, endLat, endLng);
    const coveredDistance = calculateDistance(startLat, startLng, currentLat, currentLng);
    const remainingDistance = calculateDistance(currentLat, currentLng, endLat, endLng);
    
    let progress = (coveredDistance / totalDistance) * 100;
    progress = Math.min(progress, 100);
    
    const completed = remainingDistance <= 0.5;
    
    return {
        progress: Math.round(progress),
        totalDistance: totalDistance.toFixed(2),
        coveredDistance: coveredDistance.toFixed(2),
        remainingDistance: remainingDistance.toFixed(2),
        completed: completed
    };
}

// Popup image functions - FIXED
function showPopup(imageUrl) {
    const popup = document.getElementById('popup-image');
    const img = document.getElementById('popup-img');
    
    if (popup && img) {
        img.src = imageUrl;
        img.onerror = function() {
            // Enhanced fallback with a beautiful SVG
            this.src = 'data:image/svg+xml;base64,' + btoa(`
                <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grad1)"/>
                    <circle cx="200" cy="100" r="40" fill="rgba(255,255,255,0.3)"/>
                    <text x="50%" y="60%" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">🚌</text>
                    <text x="50%" y="75%" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle">Welcome to Bus Tracker!</text>
                    <text x="50%" y="85%" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.8)" text-anchor="middle">Track your college buses in real-time</text>
                </svg>
            `);
        };
        
        popup.classList.remove('hidden');
        
        if (popupTimeout) clearTimeout(popupTimeout);
        popupTimeout = setTimeout(() => {
            closePopup();
        }, 4000);
    }
}

function closePopup() {
    const popup = document.getElementById('popup-image');
    if (popup) {
        popup.classList.add('hidden');
        if (popupTimeout) {
            clearTimeout(popupTimeout);
            popupTimeout = null;
        }
    }
}

function showWelcomePopup() {
    // Only show if no student is logged in (before login only)
    if (currentStudent) return;
    
    // Use your local image - this should load reliably
    const imageUrl = './images/MainBefore.jpg?' + Date.now();
    showPopup(imageUrl);
}

// Smooth update functions
function showUpdatingIndicator() {
    const indicator = document.getElementById('updating-indicator');
    if (indicator) {
        indicator.classList.remove('hidden');
    }
}

function hideUpdatingIndicator() {
    const indicator = document.getElementById('updating-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

// Update last refresh time
function updateLastRefreshTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    // Add this element to your HTML if you want to show last refresh time
    const refreshTimeElement = document.getElementById('last-refresh-time');
    if (refreshTimeElement) {
        refreshTimeElement.textContent = `Last updated: ${timeString}`;
    }
}

// Authentication Functions
function showLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.querySelectorAll('.tab-btn')[1].classList.remove('active');
    clearMessage();
}

function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.querySelectorAll('.tab-btn')[0].classList.remove('active');
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    clearMessage();
}

function clearMessage() {
    document.getElementById('form-message').classList.add('hidden');
}

async function register() {
    const name = document.getElementById('reg-name').value.trim();
    const studentId = document.getElementById('reg-student-id').value.trim();
    const roll = document.getElementById('reg-roll').value.trim();
    const department = document.getElementById('reg-department').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    if (!name || !studentId || !roll || !department || !phone || !password || !confirmPassword) {
        showMessage('Please fill all required fields', false);
        return;
    }

    if (password !== confirmPassword) {
        showMessage('Passwords do not match', false);
        return;
    }

    if (password.length < 6) {
        showMessage('Password must be at least 6 characters', false);
        return;
    }

    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(phone)) {
        showMessage('Please enter a valid phone number', false);
        return;
    }

    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showMessage('Please enter a valid email address', false);
            return;
        }
    }

    const registerBtn = document.getElementById('register-btn');
    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering...';

    try {
        const registrationData = {
            name: name,
            studentId: studentId,
            roll: roll,
            department: department,
            phone: phone,
            email: email,
            password: password
        };

        const formData = new FormData();
        formData.append('action', 'registerStudent');
        formData.append('data', JSON.stringify(registrationData));

        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const responseText = await response.text();
            
            try {
                const result = JSON.parse(responseText);
                
                if (result.success) {
                    showMessage('Registration successful! Please wait for admin approval.', true);
                    clearRegistrationForm();
                    setTimeout(() => {
                        showLogin();
                    }, 4000);
                } else {
                    showMessage(result.error || 'Registration failed. Please try again.', false);
                }
            } catch (parseError) {
                showMessage('Registration submitted. Please contact admin if you don\'t receive confirmation.', true);
                clearRegistrationForm();
                setTimeout(() => {
                    showLogin();
                }, 4000);
            }
        } else {
            throw new Error(`Server responded with status: ${response.status}`);
        }

    } catch (error) {
        console.error('Registration error:', error);
        showMessage('Registration failed. Please check your internet connection and try again.', false);
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Register';
    }
}

function clearRegistrationForm() {
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-student-id').value = '';
    document.getElementById('reg-roll').value = '';
    document.getElementById('reg-department').value = '';
    document.getElementById('reg-phone').value = '';
    document.getElementById('reg-email').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-confirm-password').value = '';
}

async function login() {
    const roll = document.getElementById('roll').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!roll || !password) {
        showMessage('Please enter both roll number and password', false);
        return;
    }

    try {
        const students = await getSheet('Students');
        let student = null;
        
        if (students.length > 1) {
            for (let i = 1; i < students.length; i++) {
                if (students[i][2] === roll && students[i][5] === password) {
                    student = {
                        name: students[i][0],
                        studentId: students[i][1],
                        roll: students[i][2],
                        department: students[i][3],
                        phone: students[i][4],
                        password: students[i][5],
                        status: students[i][6] || 'pending'
                    };
                    break;
                }
            }
        }

        if (student && student.status === 'approved') {
            currentStudent = student;
            document.getElementById('student-name').textContent = `Welcome, ${student.name}`;
            showDashboard();
            loadBuses();
        } else if (student && student.status === 'pending') {
            showMessage('Your account is pending approval. Please wait for admin confirmation.', false);
        } else if (student && student.status === 'rejected') {
            showMessage('Your account has been rejected. Please contact admin for more information.', false);
        } else {
            showMessage('Invalid roll number or password', false);
        }
    } catch (error) {
        showMessage('Login failed. Please try again.', false);
        console.error('Login error:', error);
    }
}

function showMessage(message, isSuccess = true) {
    const messageDiv = document.getElementById('form-message');
    messageDiv.textContent = message;
    messageDiv.className = isSuccess ? 'success' : 'error';
    messageDiv.classList.remove('hidden');
    
    if (!isSuccess) {
        setTimeout(() => {
            messageDiv.classList.add('hidden');
        }, 8000);
    }
}

function showDashboard() {
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('refresh-btn').classList.remove('hidden');
    
    // NO POPUP AFTER LOGIN - Removed the popup from here completely
}

// Search Functions
function searchBuses() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
    const busCards = document.querySelectorAll('.bus-card');
    
    busCards.forEach(card => {
        const busText = card.textContent.toLowerCase();
        if (busText.includes(searchTerm)) {
            card.style.display = 'block';
            card.style.borderColor = searchTerm ? '#2196F3' : '#e8e8e8';
        } else {
            card.style.display = searchTerm ? 'none' : 'block';
            card.style.borderColor = '#e8e8e8';
        }
    });
}

// Bus Data Functions - IMPROVED VERSION
async function loadBuses() {
    if (isUpdating) return;
    
    try {
        isUpdating = true;
        showUpdatingIndicator();
        
        // Only show "Loading buses..." if there are no buses displayed yet
        const container = document.getElementById('buses-container');
        if (buses.length === 0 && (!container.children.length || container.innerHTML.includes('Loading'))) {
            container.innerHTML = '<div class="loading">Loading buses...</div>';
        }
        
        const [busData, locationData] = await Promise.all([
            getSheet('Buses'),
            getSheet('LiveLocations')
        ]);

        const newBuses = [];
        const newLiveLocations = [];

        if (busData.length > 1) {
            for (let i = 1; i < busData.length; i++) {
                if (busData[i] && busData[i].length >= 6) {
                    const bus = {
                        busId: busData[i][0] || '',
                        route: busData[i][1] || 'Not assigned',
                        driver: busData[i][2] || 'Not assigned',
                        phone: busData[i][3] || 'Not provided',
                        capacity: busData[i][4] || 'Not specified',
                        status: busData[i][5] || 'inactive',
                        startTime: busData[i][6] || 'Not set',
                        endTime: busData[i][7] || 'Not set',
                        routeKey: busData[i][8] || '',
                        startLat: busData[i][9] ? parseFloat(busData[i][9]) : null,
                        startLng: busData[i][10] ? parseFloat(busData[i][10]) : null,
                        endLat: busData[i][11] ? parseFloat(busData[i][11]) : null,
                        endLng: busData[i][12] ? parseFloat(busData[i][12]) : null
                    };
                    
                    if (validateBusData(bus)) {
                        newBuses.push(bus);
                    }
                }
            }
        }

        if (locationData.length > 1) {
            for (let i = 1; i < locationData.length; i++) {
                if (locationData[i] && locationData[i][0]) {
                    const location = {
                        busId: locationData[i][0],
                        latitude: parseFloat(locationData[i][1]) || 0,
                        longitude: parseFloat(locationData[i][2]) || 0,
                        speed: locationData[i][3] || '0',
                        lastUpdate: locationData[i][4] || '',
                        trackingStatus: locationData[i][5] || 'INACTIVE'
                    };
                    
                    if (validateLocationData(location)) {
                        newLiveLocations.push(location);
                    }
                }
            }
        }

        buses = newBuses;
        liveLocations = newLiveLocations;

        // Use smooth update instead of clearing everything
        await displayBusesSmooth();
        
        // Update last refresh time
        updateLastRefreshTime();
        
    } catch (error) {
        console.error('Error loading buses:', error);
        // Only show error if there are no buses currently displayed
        if (buses.length === 0) {
            document.getElementById('buses-container').innerHTML = 
                `<div class="error">
                    <p>Error loading bus data. Please try again.</p>
                    <button class="btn btn-small" onclick="loadBuses()">Try Again</button>
                </div>`;
        }
    } finally {
        isUpdating = false;
        hideUpdatingIndicator();
    }
}

// IMPROVED displayBusesSmooth function
async function displayBusesSmooth() {
    const container = document.getElementById('buses-container');
    
    if (buses.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No buses available at the moment.</p>';
        return;
    }

    // If this is the first load or container is empty/has loading message
    if (!container.children.length || 
        container.querySelector('.loading') || 
        container.querySelector('.error') ||
        container.innerHTML.includes('No buses available')) {
        await displayBuses();
        return;
    }

    // For updates: fade slightly and update content
    container.style.transition = 'opacity 0.3s ease';
    container.style.opacity = '0.7';
    
    setTimeout(async () => {
        await displayBuses();
        container.style.opacity = '1';
    }, 200);
}

async function displayBuses() {
    const container = document.getElementById('buses-container');
    container.innerHTML = '';

    if (buses.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No buses available at the moment.</p>';
        return;
    }

    for (const bus of buses) {
        const location = liveLocations.find(loc => loc.busId === bus.busId);
        const busCard = await createBusCard(bus, location);
        container.appendChild(busCard);
    }
}

// Helper Functions
function isValidTimestamp(str) {
    if (!str || typeof str !== 'string') return false;
    
    const timestampPatterns = [
        /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        /^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}$/
    ];
    
    return timestampPatterns.some(pattern => pattern.test(str));
}

function getTrackingStatus(bus, location) {
    if (!location) return 'inactive';
    if (bus.status !== 'active') return 'inactive';
    
    if (location.latitude !== 0 && location.longitude !== 0) {
        if (location.trackingStatus === 'ACTIVE') return 'live';
        
        if (location.trackingStatus && isValidTimestamp(location.trackingStatus)) {
            const now = new Date();
            const trackingTime = new Date(location.trackingStatus);
            const minutesAgo = (now - trackingTime) / (1000 * 60);
            
            if (!isNaN(trackingTime.getTime()) && minutesAgo <= 15) return 'live';
        }
        
        if (location.lastUpdate) {
            const now = new Date();
            const lastUpdate = new Date(location.lastUpdate);
            const minutesAgo = (now - lastUpdate) / (1000 * 60);
            
            if (!isNaN(lastUpdate.getTime()) && minutesAgo <= 10) return 'live';
        }
    }
    
    return 'offline';
}

function getSignalQuality(lastUpdate) {
    if (!lastUpdate) return 0;
    
    const now = new Date();
    const updateTime = new Date(lastUpdate);
    const minutesAgo = (now - updateTime) / (1000 * 60);
    
    if (minutesAgo < 1) return 4;
    if (minutesAgo < 3) return 3;
    if (minutesAgo < 5) return 2;
    if (minutesAgo < 10) return 1;
    return 0;
}

function createSignalBars(quality) {
    let html = '<div class="connection-quality"><div class="signal-bars">';
    for (let i = 1; i <= 4; i++) {
        html += `<div class="signal-bar ${i <= quality ? 'active' : ''}"></div>`;
    }
    html += '</div></div>';
    return html;
}

function formatLastSeen(lastUpdate) {
    if (!lastUpdate) return 'Never';
    
    const now = new Date();
    const updateTime = new Date(lastUpdate);
    const minutesAgo = Math.floor((now - updateTime) / (1000 * 60));
    
    if (minutesAgo < 1) return 'Just now';
    if (minutesAgo < 60) return `${minutesAgo} min ago`;
    
    const hoursAgo = Math.floor(minutesAgo / 60);
    if (hoursAgo < 24) return `${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago`;
    
    const daysAgo = Math.floor(hoursAgo / 24);
    return `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;
}

async function createBusCard(bus, location) {
    const card = document.createElement('div');
    const trackingStatus = getTrackingStatus(bus, location);
    const signalQuality = getSignalQuality(location?.lastUpdate);
    const lastSeen = formatLastSeen(location?.lastUpdate);
    
    card.className = `bus-card ${trackingStatus}`;

    let statusClass = '', statusText = '', indicatorClass = '';

    switch (trackingStatus) {
        case 'live':
            statusClass = 'status-live';
            statusText = 'LIVE TRACKING';
            indicatorClass = 'live';
            break;
        case 'offline':
            statusClass = 'status-offline';
            statusText = 'BUS ACTIVE';
            indicatorClass = 'offline';
            break;
        default:
            statusClass = 'status-inactive';
            statusText = 'INACTIVE';
            indicatorClass = 'inactive';
    }

    let locationName = 'Location not available';
    if (location && location.latitude !== 0 && location.longitude !== 0) {
        locationName = await getLocationName(location.latitude, location.longitude);
    }

    card.innerHTML = `
        <div class="tracking-indicator ${indicatorClass}"></div>
        <div class="bus-info">
            <div>
                <h4>${bus.busId}</h4>
                <p><strong>Route:</strong> ${bus.route}</p>
                <p><strong>Driver:</strong> ${bus.driver}</p>
                <p><strong>Phone:</strong> ${bus.phone}</p>
                <p><strong>Time:</strong> ${bus.startTime} - ${bus.endTime}</p>
                <p><strong>Capacity:</strong> ${bus.capacity}</p>
            </div>
            <div>
                <span class="bus-status ${statusClass}">
                    ${statusText}
                    ${trackingStatus === 'live' ? createSignalBars(signalQuality) : ''}
                </span>
            </div>
        </div>
        
        ${location && trackingStatus === 'live' ? `
            <div class="speed-indicator">
                Speed: ${location.speed} km/h
            </div>
            <div class="location-display">
                <p class="location-name">${locationName}</p>
                <p><strong>Last Updated:</strong> ${formatLastSeen(location.lastUpdate)}</p>
            </div>
            <div class="location-info live">
                <p><strong>Real-time Tracking:</strong> Active</p>
                <p><strong>Signal Quality:</strong> ${['No Signal', 'Poor', 'Fair', 'Good', 'Excellent'][signalQuality]}</p>
                <p><strong>Last Update:</strong> ${lastSeen}</p>
            </div>
            <div class="bus-actions">
                <button class="btn btn-small btn-success" onclick="showDistanceTracking('${bus.busId}')">
                    Find This Bus
                </button>
                <button class="btn btn-small btn-secondary" onclick="showRouteProgress('${bus.busId}')">
                    Route Progress
                </button>
            </div>
        ` : `
            <div class="location-display" style="background: #f9f9f9; border-left-color: #999;">
                <p><strong>Location Status:</strong></p>
                <p>${trackingStatus === 'offline' ? 'Bus active but location not available' : 'Bus not currently tracking'}</p>
                ${location && trackingStatus === 'offline' ? `<p><strong>Last seen:</strong> ${lastSeen}</p>` : ''}
            </div>
            <div class="location-info ${trackingStatus === 'offline' ? 'offline' : ''}">
                <p><strong>Status:</strong> ${trackingStatus === 'offline' ? 'Bus is active but not sharing location' : 'Bus is not currently active'}</p>
                ${location && trackingStatus === 'offline' ? `<p class="last-seen">Last seen: ${lastSeen}</p>` : ''}
            </div>
        `}
    `;

    return card;
}

// Distance Tracking Functions
async function showDistanceTracking(busId) {
    const bus = buses.find(b => b.busId === busId);
    const location = liveLocations.find(l => l.busId === busId);
    
    if (!bus || !location) {
        alert('Bus location not available');
        return;
    }

    currentBusTracking = { bus, location };
    
    if (!userLocation) {
        showLocationModal();
        return;
    }
    
    showDistanceModal(bus, location);
}

async function showRouteProgress(busId) {
    const bus = buses.find(b => b.busId === busId);
    const location = liveLocations.find(l => l.busId === busId);
    
    if (!bus || !location) {
        alert('Bus location not available');
        return;
    }
    
    if (!bus.startLat || !bus.startLng || !bus.endLat || !bus.endLng) {
        alert('Route coordinates not configured for this bus');
        return;
    }

    currentBusTracking = { bus, location };
    showRouteProgressModal(bus, location);
}

function showLocationModal() {
    document.getElementById('location-modal').classList.remove('hidden');
}

function closeLocationModal() {
    document.getElementById('location-modal').classList.add('hidden');
}

async function requestLocation() {
    try {
        await getUserLocation();
        closeLocationModal();
        
        if (currentBusTracking) {
            showDistanceModal(currentBusTracking.bus, currentBusTracking.location);
        }
    } catch (error) {
        alert('Unable to get your location. Please enable location services and try again.');
        console.error('Location error:', error);
    }
}

async function showDistanceModal(bus, location) {
    if (!userLocation) {
        showLocationModal();
        return;
    }
    
    document.getElementById('modal-bus-title').textContent = `Find ${bus.busId}`;
    document.getElementById('distance-modal').classList.remove('hidden');
    
    const distance = calculateDistance(
        userLocation.latitude, userLocation.longitude,
        location.latitude, location.longitude
    );
    
    const speed = parseFloat(location.speed) || 0;
    const eta = calculateETA(distance, speed);
    
    const userLocationName = await getLocationName(userLocation.latitude, userLocation.longitude);
    const busLocationName = await getLocationName(location.latitude, location.longitude);
    
    document.getElementById('distance-info').innerHTML = `
        <div class="distance-info">${distance.toFixed(2)} km</div>
        <div class="eta-info">ETA: ${eta}</div>
        <p><strong>Your Location:</strong> ${userLocationName}</p>
        <p><strong>Bus Location:</strong> ${busLocationName}</p>
        <p><strong>Bus Speed:</strong> ${location.speed} km/h</p>
    `;
    
    if (speed > 0) {
        document.getElementById('next-stop-info').classList.remove('hidden');
        document.getElementById('next-stop-name').textContent = 'Main Campus Gate';
        document.getElementById('next-stop-eta').textContent = `ETA: ${Math.round(distance / speed * 60)} minutes`;
    }
    
    // Update the button for distance tracking (your location to bus location)
    const routeBtn = document.getElementById('route-btn');
    if (routeBtn) {
        routeBtn.textContent = 'Get Directions to Bus';
        routeBtn.onclick = () => openDirectionsToBus(bus, location);
    }
}

async function showRouteProgressModal(bus, location) {
    document.getElementById('modal-bus-title').textContent = `Route Progress - ${bus.busId}`;
    document.getElementById('distance-modal').classList.remove('hidden');
    
    const progressData = calculateRouteProgress(
        bus.startLat, bus.startLng,
        bus.endLat, bus.endLng,
        location.latitude, location.longitude
    );
    
    const startLocationName = await getLocationName(bus.startLat, bus.startLng);
    const endLocationName = await getLocationName(bus.endLat, bus.endLng);
    const currentLocationName = await getLocationName(location.latitude, location.longitude);
    
    const speed = parseFloat(location.speed) || 0;
    const etaToEnd = calculateETA(parseFloat(progressData.remainingDistance), speed);
    
    document.getElementById('distance-info').innerHTML = `
        <div class="route-progress">
            <div class="progress-header">
                <h3>${bus.route}</h3>
                <div class="progress-percentage ${progressData.completed ? 'completed' : ''}">${progressData.progress}%</div>
            </div>
            
            <div class="progress-bar-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progressData.progress}%"></div>
                    <div class="bus-marker" style="left: ${Math.min(progressData.progress, 95)}%">🚌</div>
                </div>
            </div>
            
            <div class="route-details">
                <div class="route-point start">
                    <div class="point-marker">🟢</div>
                    <div class="point-info">
                        <strong>Start:</strong> ${startLocationName}<br>
                        <small>Route begins here</small>
                    </div>
                </div>
                
                <div class="route-point current">
                    <div class="point-marker">📍</div>
                    <div class="point-info">
                        <strong>Current Position:</strong> ${currentLocationName}<br>
                        <small>Bus is here now</small>
                    </div>
                </div>
                
                <div class="route-point end">
                    <div class="point-marker">🔴</div>
                    <div class="point-info">
                        <strong>Destination:</strong> ${endLocationName}<br>
                        <small>Final stop</small>
                    </div>
                </div>
            </div>
            
            <div class="progress-stats">
                <div class="stat">
                    <strong>Total Route:</strong><br>${progressData.totalDistance} km
                </div>
                <div class="stat">
                    <strong>Completed:</strong><br>${progressData.coveredDistance} km
                </div>
                <div class="stat">
                    <strong>Remaining:</strong><br>${progressData.remainingDistance} km
                </div>
                <div class="stat">
                    <strong>ETA to End:</strong><br>${etaToEnd}
                </div>
                <div class="stat">
                    <strong>Current Speed:</strong><br>${location.speed} km/h
                </div>
                <div class="stat">
                    <strong>Progress:</strong><br>${progressData.progress}% Complete
                </div>
            </div>
            
            ${progressData.completed ? '<div class="completion-message">🎉 Bus has reached the destination!</div>' : ''}
        </div>
    `;
    
    // Update the button for route progress (shows full route from start to end)
    const routeBtn = document.getElementById('route-btn');
    if (routeBtn) {
        routeBtn.textContent = 'View Full Route in Maps';
        routeBtn.onclick = openFullRouteInMaps;
    }
    
    if (!progressData.completed) {
        document.getElementById('next-stop-info').classList.remove('hidden');
        document.getElementById('next-stop-name').textContent = endLocationName;
        document.getElementById('next-stop-eta').textContent = `ETA: ${etaToEnd}`;
    } else {
        document.getElementById('next-stop-info').classList.add('hidden');
    }
}

function closeDistanceModal() {
    document.getElementById('distance-modal').classList.add('hidden');
    currentBusTracking = null;
}

// FIXED: Function for "Find This Bus" button - shows directions from user location to bus location
function openDirectionsToBus(bus, location) {
    if (!userLocation) {
        alert('Your location is not available. Please enable location services.');
        return;
    }
    
    if (!location || !location.latitude || !location.longitude) {
        alert('Bus location not available');
        return;
    }
    
    // Create Google Maps URL for directions from user location to bus location
    const userCoords = `${userLocation.latitude},${userLocation.longitude}`;
    const busCoords = `${location.latitude},${location.longitude}`;
    
    // Google Maps directions URL format
    const directionsUrl = `https://www.google.com/maps/dir/${userCoords}/${busCoords}`;
    
    // Open in new tab
    window.open(directionsUrl, '_blank');
}

// FIXED: Function for "Route Progress" button - shows full route from start to end via current position
function openFullRouteInMaps() {
    if (!currentBusTracking || !currentBusTracking.bus) return;
    
    const bus = currentBusTracking.bus;
    const location = currentBusTracking.location;
    
    if (bus.startLat && bus.startLng && bus.endLat && bus.endLng) {
        const waypoints = [
            `${bus.startLat},${bus.startLng}`,
            `${location.latitude},${location.longitude}`,
            `${bus.endLat},${bus.endLng}`
        ];
        
        const url = `https://www.google.com/maps/dir/${waypoints.join('/')}/data=!3m1!4b1!4m2!4m1!3e0`;
        window.open(url, '_blank');
    } else {
        alert('Route coordinates not available for this bus');
    }
}

// Legacy function (keeping for compatibility)
function openRouteInMaps() {
    // This will be used based on context - either for directions to bus or full route
    if (currentBusTracking && currentBusTracking.bus && currentBusTracking.bus.startLat) {
        // If we have route data, show full route
        openFullRouteInMaps();
    } else {
        // Otherwise, show directions to bus
        openDirectionsToBus(currentBusTracking.bus, currentBusTracking.location);
    }
}

function validateBusData(bus) {
    return bus.busId && 
           bus.route && 
           bus.driver && 
           typeof bus.busId === 'string' &&
           bus.busId.trim() !== '';
}

function validateLocationData(location) {
    return location.busId &&
           typeof location.latitude === 'number' &&
           typeof location.longitude === 'number' &&
           !isNaN(location.latitude) &&
           !isNaN(location.longitude) &&
           Math.abs(location.latitude) <= 90 &&
           Math.abs(location.longitude) <= 180;
}

function logout() {
    currentStudent = null;
    userLocation = null;
    currentBusTracking = null;
    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('refresh-btn').classList.add('hidden');
    document.getElementById('roll').value = '';
    document.getElementById('password').value = '';
    document.getElementById('search-input').value = '';
    clearMessage();
}

// Event Listeners
document.getElementById('password').addEventListener('keypress', function(event) {
    if (event.key === 'Enter') login();
});

document.getElementById('roll').addEventListener('keypress', function(event) {
    if (event.key === 'Enter') document.getElementById('password').focus();
});

document.getElementById('reg-confirm-password').addEventListener('keypress', function(event) {
    if (event.key === 'Enter') register();
});

document.getElementById('reg-confirm-password').addEventListener('input', function() {
    const password = document.getElementById('reg-password').value;
    const confirmPassword = this.value;
    
    if (confirmPassword && password !== confirmPassword) {
        this.style.borderColor = '#f44336';
    } else {
        this.style.borderColor = '#ddd';
    }
});

document.addEventListener('click', function(event) {
    const distanceModal = document.getElementById('distance-modal');
    const locationModal = document.getElementById('location-modal');
    const popupOverlay = document.getElementById('popup-image');
    
    if (event.target === distanceModal) {
        closeDistanceModal();
    }
    
    if (event.target === locationModal) {
        closeLocationModal();
    }
    
    if (event.target === popupOverlay) {
        closePopup();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const distanceModal = document.getElementById('distance-modal');
        const locationModal = document.getElementById('location-modal');
        const popupOverlay = document.getElementById('popup-image');
        
        if (!distanceModal.classList.contains('hidden')) {
            closeDistanceModal();
        }
        
        if (!locationModal.classList.contains('hidden')) {
            closeLocationModal();
        }
        
        if (!popupOverlay.classList.contains('hidden')) {
            closePopup();
        }
    }
});

// FIXED: Auto refresh every 1 minute (changed from 30 seconds)
setInterval(() => {
    if (currentStudent && !document.getElementById('dashboard').classList.contains('hidden') && !isUpdating) {
        loadBuses();
    }
}, 60000); // Changed from 30000 to 60000 (1 minute)

// FIXED INITIALIZATION - Show popup only when page loads (before login)
document.addEventListener('DOMContentLoaded', function() {
    showLogin();
    
    // Show welcome popup immediately when page first loads (before any login)
    setTimeout(() => {
        showWelcomePopup();
    }, 500);
});

showLogin(); */
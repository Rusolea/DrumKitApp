// Este archivo ya no es un módulo
// No hay importaciones, usamos variables globales directamente

// MediaPipe namespace variables
let mpHands, mpCamera, mpDrawingUtils;

// DOM elements
const video = document.getElementById('video-input');
const canvas = document.getElementById('output-canvas');
const ctx = canvas.getContext('2d');
const permissionRequest = document.getElementById('permission-request');
const appContent = document.getElementById('app-content');
const grantPermissionBtn = document.getElementById('grant-permission');
const toggleCameraBtn = document.getElementById('toggle-camera');
const resetPositionsBtn = document.getElementById('reset-positions');
const drums = document.querySelectorAll('.drum');

// App state
let cameraInstance;
let cameraActive = false;
let drumPositions = {};
let handLandmarks = [];
let lastPlayedTime = {};
let cooldownTime = 500; // ms between consecutive drum hits

// Debug function for better logging
function debug(message) {
    console.log(`[AirDrumKit] ${message}`);
}

// Check camera permission status
function checkCameraPermission() {
    return navigator.permissions.query({name: 'camera'})
        .then(permissionStatus => {
            debug(`Camera permission status: ${permissionStatus.state}`);
            return permissionStatus.state;
        })
        .catch(error => {
            debug(`Error checking camera permission: ${error.message}`);
            return 'unknown';
        });
}

// Hand connections for drawing
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],  // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],  // Index finger
    [0, 9], [9, 10], [10, 11], [11, 12],  // Middle finger
    [0, 13], [13, 14], [14, 15], [15, 16],  // Ring finger
    [0, 17], [17, 18], [18, 19], [19, 20],  // Pinky
    [5, 9], [9, 13], [13, 17], [0, 17]  // Palm
];

// Audio context and sounds
let audioContext;
const audioSamples = {
    hihat: null,
    snare: null,
    kick: null,
    tom1: null,
    tom2: null
};

// Custom drawing functions
function drawConnectorsCustom(ctx, landmarks, connections, options = {}) {
    const color = options.color || '#00FF00';
    const lineWidth = options.lineWidth || 2;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    for (const connection of connections) {
        const [i, j] = connection;
        if (landmarks[i] && landmarks[j]) {
            ctx.beginPath();
            ctx.moveTo(landmarks[i].x * ctx.canvas.width, landmarks[i].y * ctx.canvas.height);
            ctx.lineTo(landmarks[j].x * ctx.canvas.width, landmarks[j].y * ctx.canvas.height);
            ctx.stroke();
        }
    }
}

function drawLandmarksCustom(ctx, landmarks, options = {}) {
    const color = options.color || '#FF0000';
    const radius = options.radius || 3;

    ctx.fillStyle = color;

    for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(
            landmark.x * ctx.canvas.width,
            landmark.y * ctx.canvas.height,
            radius,
            0,
            2 * Math.PI
        );
        ctx.fill();
    }
}

// Draw the virtual drums on canvas
function drawDrums() {
    for (const [name, position] of Object.entries(drumPositions)) {
        const x = position.x * canvas.width;
        const y = position.y * canvas.height;
        const radius = position.radius * Math.min(canvas.width, canvas.height);
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.3;
        
        // Set color based on drum type
        switch (name) {
            case 'hihat': ctx.fillStyle = '#f1c40f'; break;
            case 'snare': ctx.fillStyle = '#3498db'; break;
            case 'kick': ctx.fillStyle = '#e74c3c'; break;
            case 'tom1': ctx.fillStyle = '#9b59b6'; break;
            case 'tom2': ctx.fillStyle = '#2ecc71'; break;
            default: ctx.fillStyle = '#cccccc';
        }
        
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw drum name
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(name, x, y);
    }
}

// Handle hand detection results
function onHandsResults(results) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw drums on canvas
    drawDrums();
    
    if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
        return;
    }
    
    // Store hand landmarks
    handLandmarks = results.multiHandLandmarks;
    
    // Draw hands
    for (const landmarks of results.multiHandLandmarks) {
        // Usar nuestras propias implementaciones
        drawConnectorsCustom(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
        drawLandmarksCustom(ctx, landmarks, { color: '#FF0000', lineWidth: 1 });
        
        // Check finger tip positions (index finger)
        const indexFingerTip = landmarks[8];
        checkDrumHit(indexFingerTip);
    }
}

// Initialize the app
function initApp() {
    try {
        // Verify that all DOM elements are available
        if (!video || !canvas || !ctx || !permissionRequest || !appContent || 
            !grantPermissionBtn || !toggleCameraBtn || !resetPositionsBtn) {
            throw new Error('Missing required DOM elements');
        }
        
        // Set up canvas dimensions
        function updateCanvasDimensions() {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        
        // Initialize drum positions based on video dimensions
        function initDrumPositions() {
            // Default positions (will be overridden when video is available)
            drumPositions = {
                hihat: { x: 0.2, y: 0.3, radius: 0.15 },
                snare: { x: 0.5, y: 0.4, radius: 0.15 },
                kick: { x: 0.8, y: 0.3, radius: 0.15 },
                tom1: { x: 0.35, y: 0.6, radius: 0.15 },
                tom2: { x: 0.65, y: 0.6, radius: 0.15 }
            };
        }
        
        // Set up hand tracking
        function setupHandTracking() {
            try {
                debug('Setting up hand tracking with MediaPipe...');
                
                // Try to find the Hands constructor in various locations
                let HandsConstructor = null;
                let CameraConstructor = null;
                
                // Check different possible locations
                if (window.Hands) {
                    debug('Found Hands constructor in window.Hands');
                    HandsConstructor = window.Hands;
                } else if (window.mediapipe && window.mediapipe.Hands) {
                    debug('Found Hands constructor in window.mediapipe.Hands');
                    HandsConstructor = window.mediapipe.Hands;
                } else {
                    debug('Looking for any object that might be the Hands constructor...');
                    // Last resort: check all properties of window
                    for (const key in window) {
                        if (key.includes('Hands') && typeof window[key] === 'function') {
                            debug(`Found potential Hands constructor in window.${key}`);
                            HandsConstructor = window[key];
                            break;
                        }
                    }
                }
                
                // Same for Camera
                if (window.Camera) {
                    debug('Found Camera constructor in window.Camera');
                    CameraConstructor = window.Camera;
                } else if (window.mediapipe && window.mediapipe.Camera) {
                    debug('Found Camera constructor in window.mediapipe.Camera');
                    CameraConstructor = window.mediapipe.Camera;
                } else {
                    debug('Looking for any object that might be the Camera constructor...');
                    // Last resort: check all properties of window
                    for (const key in window) {
                        if (key.includes('Camera') && typeof window[key] === 'function') {
                            debug(`Found potential Camera constructor in window.${key}`);
                            CameraConstructor = window[key];
                            break;
                        }
                    }
                }
                
                // Check if we found the constructors
                if (!HandsConstructor) {
                    throw new Error('MediaPipe Hands constructor not found. Make sure the script is loaded correctly.');
                }
                
                if (!CameraConstructor) {
                    throw new Error('MediaPipe Camera constructor not found. Make sure the script is loaded correctly.');
                }
                
                debug('Creating Hands instance...');
                const hands = new HandsConstructor({
                    locateFile: (file) => {
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                    }
                });
                
                hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                
                hands.onResults(onHandsResults);
                
                debug('Creating Camera instance...');
                cameraInstance = new CameraConstructor(video, {
                    onFrame: async () => {
                        if (cameraActive) {
                            try {
                                await hands.send({ image: video });
                            } catch (error) {
                                console.error('Error in video processing:', error);
                                debug(`Error in video processing: ${error.message}`);
                            }
                        }
                        
                        if (!canvas.width || !canvas.height) {
                            updateCanvasDimensions();
                        }
                    },
                    width: 640,
                    height: 480
                });
                
                debug('Hand tracking setup successful');
            } catch (error) {
                console.error('Error setting up tracking:', error);
                debug(`Error setting up tracking: ${error.message}`);
                alert('Error setting up tracking. Your browser may not be compatible.');
            }
        }
        
        // Initialize everything
        initDrumPositions();
        setupHandTracking();
        
        // Event listeners
        grantPermissionBtn.addEventListener('click', startCamera);
        toggleCameraBtn.addEventListener('click', toggleCamera);
        resetPositionsBtn.addEventListener('click', initDrumPositions);
        
        // Manually trigger a hit when clicking a drum (for testing)
        drums.forEach(drum => {
            drum.addEventListener('click', () => {
                const sound = drum.dataset.sound;
                playDrumSound(sound);
                animateDrum(sound);
            });
        });
        
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Error initializing app:', error);
        alert('There was an error initializing the application. Please reload the page and try again.');
    }
}

// Start the camera with permissions
function startCamera() {
    debug('Requesting camera permissions...');
    
    // Check permission status first
    checkCameraPermission().then(status => {
        debug(`Initial permission status: ${status}`);
        
        // First, explicitly check for camera permission
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                debug('Camera permission granted. Stream obtained.');
                // Stop this initial stream - we'll let the Camera class handle it
                stream.getTracks().forEach(track => {
                    debug(`Stopping video track: ${track.label}`);
                    track.stop();
                });
                
                debug('Initializing audio context...');
                // Now proceed with audio context and sound loading
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Load drum sounds
                const sounds = ['hihat', 'snare', 'kick', 'tom1', 'tom2'];
                const soundUrls = {
                    // Usando recursos de sonido distintos y confiables
                    hihat: 'https://cdn.freesound.org/previews/558/558659_6182358-lq.mp3', // Hi-hat específico
                    snare: 'https://cdn.freesound.org/previews/387/387186_7255534-lq.mp3', // Snare original que funcionaba
                    kick: 'https://cdn.freesound.org/previews/66/66734_606639-lq.mp3',     // Kick de bajo
                    tom1: 'https://cdn.freesound.org/previews/95/95332_635018-lq.mp3',    // Tom alto
                    tom2: 'https://cdn.freesound.org/previews/157/157997_2940810-lq.mp3'  // Tom bajo
                };
                
                debug('Loading drum sounds...');
                const soundPromises = sounds.map(sound => 
                    fetch(soundUrls[sound])
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Error loading sound ${sound}: ${response.statusText}`);
                            }
                            debug(`Sound ${sound} downloaded successfully`);
                            return response.arrayBuffer();
                        })
                        .then(buffer => audioContext.decodeAudioData(buffer))
                        .then(decodedData => {
                            debug(`Sound ${sound} decoded successfully`);
                            audioSamples[sound] = decodedData;
                        })
                        .catch(error => {
                            console.error(`Error loading sound ${sound}:`, error);
                            debug(`Error loading sound ${sound}: ${error.message}`);
                            // No propagamos el error para evitar que fallen todos los sonidos
                            // en su lugar, retornamos una promesa resuelta
                            return Promise.resolve();
                        })
                );
                
                // Continuar incluso si algunos sonidos fallan
                Promise.allSettled(soundPromises)
                    .then(results => {
                        const successCount = results.filter(r => r.status === 'fulfilled').length;
                        debug(`Successfully loaded ${successCount} of ${sounds.length} sounds`);
                        
                        if (successCount === 0) {
                            throw new Error("No sounds were loaded successfully");
                        }
                        
                        // Start camera after sounds are loaded
                        try {
                            cameraInstance.start();
                            debug('Camera started successfully');
                            cameraActive = true;
                            permissionRequest.classList.add('hidden');
                            appContent.classList.remove('hidden');
                            toggleCameraBtn.textContent = 'Pause Camera';
                        } catch (error) {
                            console.error('Error starting camera:', error);
                            debug(`Error starting camera: ${error.message}`);
                            alert('Error starting camera. Please reload the page and try again.');
                        }
                    })
                    .catch(error => {
                        console.error('Error loading sounds:', error);
                        debug(`Error loading sounds: ${error.message}`);
                        alert('Error loading sounds. Please reload the page and try again.');
                    });
            })
            .catch(error => {
                console.error('Error accessing camera:', error);
                debug(`Error accessing camera: ${error.message}`);
                alert('Could not access the camera. Please ensure you have given the necessary permissions and that the camera is connected.');
            });
    });
}

// Toggle camera on/off
function toggleCamera() {
    cameraActive = !cameraActive;
    
    if (cameraActive) {
        cameraInstance.start();
        toggleCameraBtn.textContent = 'Pause Camera';
    } else {
        cameraInstance.stop();
        toggleCameraBtn.textContent = 'Start Camera';
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// Play a drum sound (buscar y reemplazar la función existente)
function playDrumSound(drumName) {
    const now = Date.now();
    const lastPlayTime = lastPlayedTime[drumName] || 0;
    
    // Add cooldown to prevent rapid firing of the same sound
    if (now - lastPlayTime < cooldownTime) {
        return false;
    }
    
    lastPlayedTime[drumName] = now;
    
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Si el sonido no está disponible, usar el generador de sonidos
    if (!audioSamples[drumName]) {
        debug(`${drumName} sample not loaded, using fallback sound`);
        return generateFallbackSound(drumName);
    }
    
    try {
        // Create a new audio source
        const source = audioContext.createBufferSource();
        source.buffer = audioSamples[drumName];
        source.connect(audioContext.destination);
        source.start();
        
        debug(`Playing ${drumName} sound`);
        return true;
    } catch (error) {
        console.error(`Error playing ${drumName} sound:`, error);
        debug(`Error playing ${drumName}: ${error.message}, using fallback`);
        return generateFallbackSound(drumName);
    }
}

// Check if a finger tip hit a drum
function checkDrumHit(fingerTip) {
    const now = Date.now();
    
    for (const [name, position] of Object.entries(drumPositions)) {
        const centerX = position.x * canvas.width;
        const centerY = position.y * canvas.height;
        const radius = position.radius * Math.min(canvas.width, canvas.height);
        
        const fingerX = fingerTip.x * canvas.width;
        const fingerY = fingerTip.y * canvas.height;
        
        // Calculate distance from finger to drum center
        const distance = Math.sqrt(
            Math.pow(fingerX - centerX, 2) + 
            Math.pow(fingerY - centerY, 2)
        );
        
        // Get last time this drum was played
        const lastPlayTime = lastPlayedTime[name] || 0;
        
        // Check if finger is inside drum circle and cooldown has passed
        if (distance < radius && (now - lastPlayTime) > cooldownTime) {
            // Play the drum sound
            playDrumSound(name);
            
            // Animate the drum
            animateDrum(name);
            
            // Set last played time
            lastPlayedTime[name] = now;
            
            // We only want to hit one drum at a time, so return
            return;
        }
    }
}

// Animate the drum visual element
function animateDrum(drumName) {
    // Find the corresponding DOM element
    const drumElement = document.querySelector(`.drum.${drumName}`);
    
    if (!drumElement) {
        return;
    }
    
    // Add active class for animation
    drumElement.classList.add('active');
    
    // Remove after animation completes
    setTimeout(() => {
        drumElement.classList.remove('active');
    }, 150);
}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    debug('DOM loaded. Starting application...');
    
    // Check browser compatibility
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        debug('Error: MediaDevices or getUserMedia not supported in this browser');
        alert('Your browser does not support camera access. Please use a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    // Give a little time for scripts to load
    setTimeout(() => {
        // Inspect available MediaPipe objects
        inspectMediaPipeObjects();
        
        try {
            debug('Checking MediaPipe compatibility...');
            // Initialize app
            initApp();
        } catch (error) {
            debug(`Error loading MediaPipe: ${error.message}`);
            console.error('Error loading MediaPipe:', error);
            alert('Error loading required libraries. Please make sure your internet connection is working correctly and reload the page.');
        }
    }, 1000); // Wait for 1 second to ensure scripts are loaded
});

// Función para inspeccionar y depurar objetos de MediaPipe disponibles
function inspectMediaPipeObjects() {
    debug('Inspecting MediaPipe objects in window...');
    
    // Verificar Hands
    if (window.Hands) {
        debug('✓ window.Hands is available');
    } else {
        debug('✗ window.Hands is NOT available');
    }
    
    // Verificar Camera
    if (window.Camera) {
        debug('✓ window.Camera is available');
    } else {
        debug('✗ window.Camera is NOT available');
    }
    
    // Verificar DrawingUtils
    if (window.drawConnectors || window.drawLandmarks) {
        debug('✓ Some drawing utilities are available');
    } else {
        debug('✗ Drawing utilities are NOT available');
    }
    
    // Verificar otros posibles namespaces
    if (window.mpHands || window.mediapipe) {
        debug('✓ Alternative MediaPipe namespaces might be available');
        if (window.mediapipe) {
            debug('Objects in mediapipe namespace: ' + Object.keys(window.mediapipe).join(', '));
        }
    } else {
        debug('✗ No alternative MediaPipe namespaces found');
    }
}

// Generate a fallback sound using Web Audio API
function generateFallbackSound(type) {
    debug(`Generating fallback sound for ${type}`);
    
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    let oscillator;
    let gainNode;
    let duration;
    
    switch (type) {
        case 'hihat':
            // High-pitched noise
            duration = 0.1;
            oscillator = audioContext.createOscillator();
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            
            gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            break;
            
        case 'snare':
            // Medium pitched noise
            duration = 0.2;
            oscillator = audioContext.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
            
            gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            break;
            
        case 'kick':
            // Low pitched sound
            duration = 0.3;
            oscillator = audioContext.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(20, audioContext.currentTime + duration);
            
            gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            break;
            
        case 'tom1':
            // Medium-low pitched sound
            duration = 0.25;
            oscillator = audioContext.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + duration);
            
            gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            break;
            
        case 'tom2':
            // Medium-high pitched sound
            duration = 0.25;
            oscillator = audioContext.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(250, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(150, audioContext.currentTime + duration);
            
            gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            break;
    }
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
    
    return true;
}
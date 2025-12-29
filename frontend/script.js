document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    const state = {
        activeTab: 'live',
        isCameraActive: false,
        socket: null,
        animationId: null,
        inFlight: false
    };

    // --- Elements ---
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const statusBadge = document.getElementById('status-badge');

    // Live Feed Elements
    const enableCameraBtn = document.getElementById('enable-camera-btn');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const videoElement = document.getElementById('webcam-video');
    const canvasElement = document.getElementById('output-canvas'); // Displays result
    const liveIndicator = document.getElementById('live-indicator');
    const fpsIndicator = document.getElementById('fps-indicator');
    const resIndicator = document.getElementById('res-indicator');
    const confSlider = document.getElementById('conf-slider');
    const confValue = document.getElementById('conf-value');

    // Hidden canvas for capturing frame to send
    const captureCanvas = document.createElement('canvas');
    const captureCtx = captureCanvas.getContext('2d');

    // Image Upload Elements
    const imageDropZone = document.getElementById('image-drop-zone');
    const imageInput = document.getElementById('image-upload-input');
    const imageResult = document.getElementById('image-result');
    const processedImage = document.getElementById('processed-image');

    // Video Upload Elements
    const videoDropZone = document.getElementById('video-drop-zone');
    const videoInput = document.getElementById('video-upload-input');
    const videoResult = document.getElementById('video-result');
    const processedVideoFeed = document.getElementById('processed-video-feed');

    // --- Initialization ---
    checkBackendHealth();

    // --- Tab Switching ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            // Update UI
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            tabContents.forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${target}`).classList.add('active');

            // Handle Camera State when switching tabs
            if (target !== 'live' && state.isCameraActive) {
                stopCamera();
            }
        });
    });

    function setResolutionLabel() {
        if (!resIndicator || !videoElement.videoWidth || !videoElement.videoHeight) return;
        resIndicator.textContent = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
    }

    function resetTelemetry() {
        if (fpsIndicator) fpsIndicator.textContent = '-';
        if (resIndicator) resIndicator.textContent = '-';
        state.lastFrameTs = null;
        state.fps = 0;
        state.gotFirstFrame = false;
    }

    function syncConfidenceLabel(value) {
        if (confValue) confValue.textContent = Number(value).toFixed(2);
    }

    function sendConfidence(value) {
        fetch('/config/conf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conf: value })
        }).catch(() => {});
    }

    function setupConfidenceControl() {
        if (!confSlider) return;
        let debounceId;
        syncConfidenceLabel(confSlider.value);
        confSlider.addEventListener('input', () => {
            syncConfidenceLabel(confSlider.value);
            clearTimeout(debounceId);
            debounceId = setTimeout(() => sendConfidence(Number(confSlider.value)), 200);
        });
    }

    // --- Live Feed Logic (WebSocket) ---
    enableCameraBtn.addEventListener('click', () => {
        startCamera();
    });

    setupConfidenceControl();

    async function startCamera() {
        try {
            resetTelemetry();
            // Get camera stream (force back camera on phones if available)
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 60, max: 120 }
                }
            });

            videoElement.srcObject = stream;

            videoElement.addEventListener('loadedmetadata', () => {
                setResolutionLabel();
            }, { once: true });

            await videoElement.play();
            setResolutionLabel();

            // Connect WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/detect`;
            state.socket = new WebSocket(wsUrl);
            state.socket.binaryType = 'blob';

            state.socket.onopen = () => {
                console.log("WebSocket Connected");
                state.isCameraActive = true;

                // UI Updates
                cameraPlaceholder.style.display = 'none';
                canvasElement.style.display = 'block';
                liveIndicator.style.display = 'block';

                state.inFlight = false;
                scheduleNextFrame();
            };

            state.socket.onmessage = (event) => {
                // Receive processed frame blob
                const blob = event.data;
                const url = URL.createObjectURL(blob);

                const img = new Image();
                img.onload = () => {
                    const ctx = canvasElement.getContext('2d');
                    // Resize canvas to match image
                    canvasElement.width = img.width;
                    canvasElement.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);

                    const now = performance.now();
                    if (state.lastFrameTs) {
                        const instantFps = 1000 / (now - state.lastFrameTs);
                        state.fps = state.fps ? (state.fps * 0.9 + instantFps * 0.1) : instantFps;
                        if (fpsIndicator) {
                            fpsIndicator.textContent = state.fps.toFixed(1);
                        }
                    }
                    state.lastFrameTs = now;
                    if (!state.gotFirstFrame) {
                        state.gotFirstFrame = true;
                    }
                };
                img.src = url;
                state.inFlight = false;
                scheduleNextFrame();
            };

            state.socket.onerror = (err) => {
                console.error("WebSocket Error:", err);
                stopCamera();
            };

            state.socket.onclose = () => {
                console.log("WebSocket Disconnected");
                stopCamera();
            };

        } catch (err) {
            console.error("Camera access denied:", err);
            alert("Could not access camera. Please allow permission.");
        }
    }

    function scheduleNextFrame() {
        if (!state.isCameraActive) return;
        setTimeout(sendFrameOnce, 0);
    }

    const SEND_EVERY_N = 1;

    function sendFrameOnce() {
        if (!state.isCameraActive || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
        if (state.inFlight) return;

        if (videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
            scheduleNextFrame();
            return;
        }

        state.frameCount = (state.frameCount || 0) + 1;
        if (state.frameCount % SEND_EVERY_N !== 0) {
            scheduleNextFrame();
            return;
        }

        // Capture at full resolution for maximum quality
        captureCanvas.width = videoElement.videoWidth;
        captureCanvas.height = videoElement.videoHeight;

        captureCtx.drawImage(videoElement, 0, 0, captureCanvas.width, captureCanvas.height);

        state.inFlight = true;
        captureCanvas.toBlob((blob) => {
            if (state.socket && state.socket.readyState === WebSocket.OPEN && blob) {
                state.socket.send(blob);
            } else {
                state.inFlight = false;
                scheduleNextFrame();
            }
        }, 'image/jpeg', 0.95);
    }

    function stopCamera() {
        state.isCameraActive = false;
        state.inFlight = false;
        state.frameCount = 0;

        if (state.socket) {
            state.socket.close();
        }

        if (videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
        }

        canvasElement.style.display = 'none';
        liveIndicator.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
        resetTelemetry();
    }

    // --- Image Upload Logic ---
    setupDragAndDrop(imageDropZone, imageInput);

    imageInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            await processImage(file);
        }
    });

    async function processImage(file) {
        const formData = new FormData();
        formData.append('file', file);

        // Show loading state
        imageDropZone.style.display = 'none';
        imageResult.style.display = 'flex';

        // Add spinner if not exists
        let spinner = imageResult.querySelector('.loading-spinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'loading-spinner';
            imageResult.querySelector('.image-wrapper').appendChild(spinner);
        }
        spinner.style.display = 'block';

        // Prepare image
        processedImage.src = '';
        processedImage.classList.remove('loaded');
        processedImage.style.opacity = '0';

        try {
            const response = await fetch('/detect_image', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);

                // Hide spinner when image loads
                processedImage.onload = () => {
                    spinner.style.display = 'none';
                    processedImage.classList.add('loaded');
                    processedImage.style.opacity = '1';
                };
                processedImage.src = url;

            } else {
                alert('Error processing image');
                resetImageUpload();
            }
        } catch (error) {
            console.error(error);
            alert('Error connecting to server');
            resetImageUpload();
        }
    }

    window.resetImageUpload = () => {
        imageDropZone.style.display = 'block';
        imageResult.style.display = 'none';
        imageInput.value = '';
        processedImage.src = '';
        processedImage.classList.remove('loaded');
        processedImage.style.opacity = '0';
        const spinner = imageResult.querySelector('.loading-spinner');
        if (spinner) spinner.style.display = 'none';
    };

    // --- Video Upload Logic ---
    setupDragAndDrop(videoDropZone, videoInput);

    videoInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            await processVideo(file);
        }
    });

    async function processVideo(file) {
        const formData = new FormData();
        formData.append('file', file);

        // Show loading state
        videoDropZone.style.display = 'none';
        videoResult.style.display = 'flex';

        // Add spinner if not exists
        let spinner = videoResult.querySelector('.loading-spinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'loading-spinner';

            const wrapper = processedVideoFeed.parentNode;
            wrapper.classList.add('video-wrapper');
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';
            wrapper.style.minHeight = '520px';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'center';
            wrapper.style.alignItems = 'center';
            wrapper.style.background = 'rgba(255, 255, 255, 0.05)';
            wrapper.style.borderRadius = '12px';
            wrapper.appendChild(spinner);
        }
        spinner.style.display = 'block';

        processedVideoFeed.src = '';
        processedVideoFeed.style.opacity = '0';

        try {
            const response = await fetch('/upload_video', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                const videoId = data.video_id;

                processedVideoFeed.onload = () => {
                    spinner.style.display = 'none';
                    processedVideoFeed.style.opacity = '1';
                };
                setTimeout(() => {
                    spinner.style.display = 'none';
                    processedVideoFeed.style.opacity = '1';
                }, 1000);

                processedVideoFeed.src = `/stream_video/${videoId}`;
            } else {
                alert('Error uploading video');
                resetVideoUpload();
            }
        } catch (error) {
            console.error(error);
            alert('Error connecting to server');
            resetVideoUpload();
        }
    }

    window.resetVideoUpload = () => {
        videoDropZone.style.display = 'block';
        videoResult.style.display = 'none';
        videoInput.value = '';
        processedVideoFeed.src = '';
        processedVideoFeed.style.opacity = '0';
        const spinner = videoResult.querySelector('.loading-spinner');
        if (spinner) spinner.style.display = 'none';
    };

    // --- Utility ---
    function setupDragAndDrop(zone, input) {
        zone.addEventListener('click', () => input.click());

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--primary)';
            zone.style.background = 'rgba(99, 102, 241, 0.1)';
        });

        zone.addEventListener('dragleave', () => {
            zone.style.borderColor = '';
            zone.style.background = '';
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = '';
            zone.style.background = '';

            if (e.dataTransfer.files.length > 0) {
                input.files = e.dataTransfer.files;
                // Trigger change event manually
                const event = new Event('change');
                input.dispatchEvent(event);
            }
        });
    }

    function checkBackendHealth() {
        fetch('/health')
            .then(response => {
                if (response.ok) {
                    // statusBadge.innerHTML = '<span class="dot"></span> System Active';
                    statusBadge.style.color = 'var(--success)';
                    statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
                    statusBadge.querySelector('.dot').style.backgroundColor = 'var(--success)';
                    statusBadge.querySelector('.dot').style.boxShadow = '0 0 8px var(--success)';
                } else {
                    setOffline();
                }
            })
            .catch(err => {
                console.error('Backend check failed:', err);
                setOffline();
            });
    }

    function setOffline() {
        statusBadge.innerHTML = '<span class="dot" style="background: var(--error); box-shadow: 0 0 8px var(--error);"></span> Offline';
        statusBadge.style.color = 'var(--error)';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.1)';
        statusBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    }
});

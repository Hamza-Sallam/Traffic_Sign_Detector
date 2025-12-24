document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    const state = {
        activeTab: 'live',
        isCameraActive: false
    };

    // --- Elements ---
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const statusBadge = document.getElementById('status-badge');

    // Live Feed Elements
    const enableCameraBtn = document.getElementById('enable-camera-btn');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const videoFeed = document.getElementById('video-feed');
    const liveIndicator = document.getElementById('live-indicator');

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

    // --- Live Feed Logic ---
    enableCameraBtn.addEventListener('click', () => {
        startCamera();
    });

    function startCamera() {
        state.isCameraActive = true;
        cameraPlaceholder.style.display = 'none';
        videoFeed.style.display = 'block';
        liveIndicator.style.display = 'block';
        videoFeed.src = '/video_feed'; // Start stream
    }

    function stopCamera() {
        state.isCameraActive = false;
        videoFeed.src = '';
        videoFeed.style.display = 'none';
        liveIndicator.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
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

        // Show loading state (optional: add spinner)
        imageDropZone.style.display = 'none';
        imageResult.style.display = 'flex';
        processedImage.src = ''; // Clear prev

        try {
            const response = await fetch('/detect_image', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
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

        videoDropZone.style.display = 'none';
        videoResult.style.display = 'flex';
        processedVideoFeed.src = '';

        try {
            const response = await fetch('/upload_video', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                const videoId = data.video_id;
                // Start streaming the processed video
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
                    statusBadge.innerHTML = '<span class="dot"></span> System Active';
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

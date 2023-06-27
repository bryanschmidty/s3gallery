
async function fetchAllObjects(prefix, accumulatedObjects = [], accumulatedPrefixes = [], marker = null) {
    return new Promise(async (resolve, reject) => {
        const params = {
            Bucket: window.bucketName,
            Delimiter: '/',
            Prefix: prefix,
        };

        if (marker) {
            params.Marker = marker;
        }

        try {
            const data = await s3.listObjects(params).promise();
            accumulatedPrefixes.push(...data.CommonPrefixes);

            if (versioningEnabled) {
                // Fetch version information for each object if versioning is enabled
                const objectsWithVersions = await Promise.all(
                    data.Contents.map(async (object) => {
                        const versions = await getObjectVersions(object.Key);
                        return {
                            ...object,
                            versions: versions,
                        };
                    })
                );

                // Replace the original objects with the objects containing version information
                accumulatedObjects.push(...objectsWithVersions);
            } else {
                accumulatedObjects.push(...data.Contents);
            }

            if (data.IsTruncated) {
                // Fetch the next set of objects
                fetchAllObjects(prefix, accumulatedObjects, accumulatedPrefixes, data.NextMarker)
                    .then((result) => resolve(result))
                    .catch((error) => reject(error));
            } else {
                let newVar = { Contents: accumulatedObjects, CommonPrefixes: accumulatedPrefixes };
                resolve(newVar);
            }
        } catch (error) {
            reject(error);
        }
    });
}

// Error modal
function showErrorModal(title, message) {
    const errorModal = document.createElement('div');
    errorModal.className = 'error-modal';
    errorModal.innerHTML = `
        <div class="error-modal-backdrop"></div>
        <div class="error-modal-content">
            <h2>${title}</h2>
            <p>${message}</p>
            <button class="error-modal-close">Close</button>
        </div>
    `;
    document.body.appendChild(errorModal);

    errorModal.querySelector('.error-modal-close').addEventListener('click', () => {
        errorModal.remove();
    });
}

// Fetch all objects in the bucket with the given prefix
async function listObjects(prefix = '') {
    try {
        showLoadingScreen();
        const data = await fetchAllObjects(prefix);
        renderBreadcrumbs(prefix);
        await renderGallery(data);
        updateImageSize();
    } catch (error) {
        if (error.message.includes("Network Failure")) {
            showErrorModal("Network Failure", "There was a network failure while trying to access the resources. " +
                "Please check your internet connection and try again. If the issue persists, ensure that your S3 bucket is properly configured and accessible. " +
                "You can also check the browser console for more details.<br /><br />" +
                "Recommended CORS config: <div class='error-modal-code'><pre>[\n" +
                "    {\n" +
                "        \"AllowedHeaders\": [\n" +
                "            \"*\"\n" +
                "        ],\n" +
                "        \"AllowedMethods\": [\n" +
                "            \"GET\",\n" +
                "            \"HEAD\"\n" +
                "        ],\n" +
                "        \"AllowedOrigins\": [\n" +
                "            \"*\"\n" +
                "        ],\n" +
                "        \"ExposeHeaders\": []\n" +
                "    }\n" +
                "]</pre></div>");
        } else {
            console.error('Error listing objects:', error);
        }
    } finally {
        const loadingScreen = document.querySelector('.loading-screen');
        if (loadingScreen) {
            loadingScreen.remove();
        }
    }

    // Update the URL with the current prefix
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("prefix", prefix);
    history.pushState({}, "", newUrl.href);
}

function renderBreadcrumbs(prefix, imageName = '') {
    const fragments = prefix.split('/').filter(fragment => fragment.length);
    const breadcrumbs = fragments.map((fragment, index) => {
        const path = fragments.slice(0, index + 1).join('/') + '/';
        return `<a href="#" data-path="${path}">${fragment}</a>`;
    }).join(' / ');

    const imageNameFragment = imageName ? ` / ${imageName}` : '';
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    breadcrumbsEl.innerHTML = `<a href="#" data-path="">${window.bucketName}</a> / ` + breadcrumbs + imageNameFragment;
    breadcrumbsEl.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            listObjects(event.target.dataset.path);
        });
    });
}

function renderFolder(prefix) {
    const folderName = prefix.Prefix.split('/').slice(-2, -1)[0]; // Get the last part of the path

    return `
        <div class="folder" data-path="${prefix.Prefix}">
            <div class="image-container">
                <img src="assets/folder_icon.svg" alt="${prefix.Prefix}">
            </div>
            <div class="image-info">
                <span class="image-name">${folderName}</span>
            </div>
        </div>
    `;
}

async function renderGallery(data) {
    const folderCount = data.CommonPrefixes.length;
    const folders = data.CommonPrefixes.map(prefix => renderFolder(prefix)).join('');

    const imageObjects = data.Contents.filter(object => !object.Key.endsWith('/'));
    const fileCount = imageObjects.length;
    const totalFileSize = imageObjects.reduce((total, object) => total + object.Size, 0);
    const humanReadableFileSize = formatBytes(totalFileSize);
    const images = await Promise.all(imageObjects.map(object => renderImage(object)));

    // Update the footer with the folder and file counts, and total file size
    updateFooter(folderCount, fileCount, humanReadableFileSize);

    return new Promise((resolve) => {
        const galleryEl = document.getElementById('gallery');
        galleryEl.innerHTML = folders + images.join('');

        galleryEl.querySelectorAll('.folder').forEach(folder =>
            folder.addEventListener('click', onFolderClick)
        );

        galleryEl.querySelectorAll('.image img').forEach(img => {
            img.addEventListener('click', onImageClick);
        });

        resolve();
    });
}

function onFolderClick(event) {
    event.preventDefault();
    listObjects(event.target.closest('.folder').dataset.path);
}

// show image modal
function closeImageModal() {
    const imageModal = document.getElementById('image-modal');
    imageModal.classList.add('hidden');
    document.removeEventListener('keydown', escapeKeyPressed);

    // Reset the zoom when closing the image modal
    resetZoom();
}

function escapeKeyPressed(event) {
    console.log('escape');
    if (event.key === 'Escape') {
        event.preventDefault()
        closeImageModal();
    }
}

async function onImageClick(event) {
    const img = event.target;
    img.classList.add('highlighted');

    // setTimeout(() => {
    //     img.classList.remove('highlighted');
    // }, 1000);

    // const imageKey = event.target.dataset.key;
    //
    // // Show the modal and load the image
    // const imageUrl = getSignedUrl(imageKey);
    // const modalImage = document.getElementById('modal-image');
    // modalImage.src = imageUrl;
    //
    // // Fetch and display image information
    // const imageInfo = await getImageInfo(imageKey);
    // displayImageInfo(imageInfo);
    //
    // // Show the modal
    // const imageModal = document.getElementById('image-modal');
    // imageModal.classList.remove('hidden');
    //
    // // Add an event listener to close the modal when the Escape key is pressed
    // document.addEventListener('keydown', escapeKeyPressed);
}
document.getElementById('close-modal').addEventListener('click', closeImageModal);


const infoPanel = document.querySelector('.info-panel');
const mainPanel = document.querySelector('.main-panel');
const imagePanel = document.querySelector('.image-panel');
const toggleInfo = document.getElementById('toggle-info');

toggleInfo.addEventListener('click', function () {
    infoPanel.classList.toggle('hidden');
    imagePanel.classList.toggle('full-width');
    toggleInfo.classList.toggle('closed');
});

// Function to format bytes into a human-readable format
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function updateFooter(folderCount, fileCount, totalFileSize) {
    const footerInfo = document.getElementById('footer-info');
    footerInfo.innerHTML = `
        <span class="footer-count">${folderCount}</span> Folders | 
        <span class="footer-count">${fileCount}</span> Files |
        <span class="footer-size">${totalFileSize}</span>
    `;
}

function getSignedUrl(key, versionId = null) {
    const params = {
        Bucket: window.bucketName,
        Key: key,
        Expires: 60 * 5 // 5 minutes
    };

    if (versionId) {
        params.VersionId = versionId;
    }

    return s3.getSignedUrl('getObject', params);
}

function getObjectVersions(imageKey) {
    return new Promise((resolve, reject) => {
        if (!versioningEnabled) {
            resolve(null);
        }

        s3.listObjectVersions({
            Bucket: window.bucketName,
            Prefix: imageKey
        }, (err, data) => {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                resolve(data.Versions);
            }
        });
    });
}

async function getObjectVersionCount(imageKey) {
    return new Promise((resolve, reject) => {
        s3.listObjectVersions({
            Bucket: window.bucketName,
            Prefix: imageKey
        }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.Versions.length);
            }
        });
    });
}

function formatLastModified(lastModified) {
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short'
    };

    const dateTimeFormat = new Intl.DateTimeFormat('en-US', options);
    const formattedParts = dateTimeFormat.formatToParts(lastModified);

    const formatted = formattedParts
        .map((part) => {
            if (part.type === 'literal') {
                return part.value.trim() === ',' ? ' ' : part.value;
            } else {
                return part.value;
            }
        })
        .join('');

    return formatted;
}

async function renderImage(object) {
    const fileExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const objectKey = object.Key;
    const fileExtension = objectKey.split('.').pop().toLowerCase();
    const isImage = fileExtensions.includes(fileExtension);
    const imageName = object.Key.split('/').pop();
    const latestVersion = getLatestVersionId(object);

    let localStorageImageData = await getImageFromIndexedDB(object.Key, latestVersion);
    let imageUrl, versionCount;
    if (localStorageImageData) {
        imageUrl = localStorageImageData.dataUrl;
        versionCount = localStorageImageData.versionCount;
    } else {
        imageUrl = isImage ? getSignedUrl(object.Key, object.VersionId) : 'assets/file_icon.svg';

        // Cache the image to localStorage if it's an image
        if (isImage) {
            localStorageImageData = await saveImageToIndexedDB(object.Key, latestVersion, imageUrl);
            versionCount = versioningEnabled ? localStorageImageData.versions.length : 1;
        }
    }

    let versionCountText = '';
    if (versioningEnabled && (versionCount > 1)) {
        versionCountText = `(${versionCount} rev)`;
    }

    // Truncate the image name and add ellipses if it's too long
    const maxLength = 20;
    const truncatedImageName = imageName.length > maxLength ? imageName.substring(0, maxLength) + '...' : imageName;

    return `
    <div class="image">
      <div class="image-container">
        <img src="${imageUrl}" alt="${object.Key}" data-key="${object.Key}">
      </div>
      <div class="image-info">
        <span class="image-name" title="${imageName}">${truncatedImageName}</span>
        <span class="image-version-count">${versionCountText}</span>
      </div>
    </div>
  `;
}

function getLatestVersionId(object) {
    if (!versioningEnabled) {
        return null;
    }

    for (const version of object.versions) {
        if (version.IsLatest) {
            return version.VersionId;
        }
    }
    return null;
}

function isVersioningEnabled() {
    if (versioningEnabled !== undefined) {
        return versioningEnabled;
    }

    try {
        const params = {Bucket: window.bucketName};

        return new Promise((resolve, reject) => {
            s3.getBucketVersioning(params, (error, response) => {
                if (error) {
                    console.error('Error checking versioning status:', error);
                    reject(error);
                } else {
                    versioningEnabled = response.Status === 'Enabled';
                    resolve(versioningEnabled);
                }
            });
        });
    } catch (error) {
        console.error('Error checking versioning status:', error);
        versioningEnabled = false;
        return false;
    }
}

async function getImageInfo(key) {
    const params = {
        Bucket: window.bucketName,
        Key: key,
    };

    const headObject = await s3.headObject(params).promise();
    const metadata = headObject.Metadata;
    const size = headObject.ContentLength;

    // Fetch the image URL and use getImageDimensions to get the dimensions
    const imageUrl = getSignedUrl(key);
    const { width, height } = await getImageDimensions(imageUrl);
    const dimensions = `${width}x${height}`;

    // Fetch object versions
    const versions = await getObjectVersions(key);

    return {key, size, dimensions, metadata, versions};
}

function getImageDimensions(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
    });
}

async function displayImageInfo(imageInfo) {
    document.getElementById('image-size').textContent = formatBytes(imageInfo.size);
    document.getElementById('image-dimensions').textContent = imageInfo.dimensions;
    document.getElementById('image-tags').textContent = imageInfo.metadata.tags || '-';

    if (!versioningEnabled) {
        return;
    }

    const versionsContainer = document.getElementById('versions-container');
    if (imageInfo.versions.length <= 1) {
        versionsContainer.classList.add('hidden');
        return;
    }

    // List the version timestamps and version IDs
    const versionsList = document.getElementById('versions-list');
    versionsList.innerHTML = '';
    imageInfo.versions.forEach(version => {
        const versionElement = document.createElement('div');
        const formattedLastModified = formatLastModified(version.LastModified);
        versionElement.textContent = formattedLastModified;
        versionElement.classList.add('version-item');
        versionElement.dataset.versionId = version.VersionId;
        if (version.IsLatest) {
            versionElement.style.fontWeight = 'bold';
        }

        versionElement.addEventListener('click', () => {
            // Load the S3 object with the selected version ID
            loadS3Object(imageInfo.key, version.VersionId);
        });
        versionsList.appendChild(versionElement);
    });

    versionsContainer.classList.remove('hidden');
}

// saving images in local storage
async function saveImageToIndexedDB(key, versionId, imageUrl, expiration = 24 * 60 * 60 * 1000) {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const dataUrl = await blobToDataURL(blob);
    const dimensions = await getImageDimensions(imageUrl);

    // const prefixedKey = `${window.bucketName}/${key}`;
    const now = new Date().getTime();
    // const keyData = {
    //     key: prefixedKey,
    //     timestamp: now + expiration,
    // };

    // Get existing data from IndexedDB
    let existingData = await getImageFromIndexedDB(key);

    if (!existingData) {
        existingData = {
            key: `${window.bucketName}/${key}`,
            timestamp: now + expiration,
            versions: versioningEnabled ? [] : null,
        };
    }

    let imageData;
    if (versioningEnabled) {
        // Fetch the object versions
        const versions = await getObjectVersions(key);

        // Iterate through the versions and create an entry in the "versions" array
        existingData.versions = existingData.versions || [];

        for (const version of versions) {
            const currentVersionId = version.VersionId;

            // Find the index of the current version in the "versions" array
            const versionIndex = existingData.versions.findIndex(v => v.versionId === currentVersionId);

            // If versionId is null or matches the current version, save the other parameters
            if (versionId === null || versionId === currentVersionId) {
                imageData = {
                    versionId: currentVersionId,
                    dataUrl: dataUrl,
                    dimensions: dimensions
                };

                if (versionIndex === -1) {
                    // Add the new version data to the "versions" array if it doesn't exist
                    existingData.versions.push(imageData);
                } else {
                    // Update the existing version data in the "versions" array
                    existingData.versions[versionIndex] = imageData;
                }
            } else if (versionIndex === -1) {
                // If the current version doesn't exist in the "versions" array, create an empty entry
                existingData.versions.push({ versionId: currentVersionId });
            }
        }
        // existingData.timestamp = keyData.timestamp;
    } else {
        // Store the imageData object directly if versioning is not enabled
        imageData = {
            dataUrl: dataUrl,
            dimensions: dimensions
        };
        // existingData.timestamp = keyData.timestamp;
        existingData = {
            ...imageData,
            ...existingData
        };
    }

    // Save the updated data to IndexedDB
    const db = await openIndexedDB();
    const transaction = db.transaction(["images"], "readwrite");
    const objectStore = transaction.objectStore("images");
    objectStore.put(existingData);

    return existingData;
}

async function getImageFromIndexedDB(key, revisionId = null) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["images"], "readonly");
        const objectStore = transaction.objectStore("images");
        const request = objectStore.get(`${window.bucketName}/${key}`);

        request.onerror = (event) => {
            console.error("Error retrieving image data from IndexedDB:", event);
            reject(event);
        };

        request.onsuccess = (event) => {
            const existingData = event.target.result;

            if (!existingData || existingData.timestamp < new Date().getTime()) {
                resolve(null);
                return;
            }

            let imageData, versionCount;
            if (versioningEnabled) {
                versionCount = existingData.versions.length;
                if (revisionId) {
                    imageData = existingData.versions.find((v) => v.versionId === revisionId);
                } else {
                    imageData = existingData.versions.find((v) => v.dataUrl); // Find the first version with dataUrl
                }
            } else {
                imageData = existingData;
            }

            resolve({
                ...imageData,
                versionCount: versionCount,
            });
        };
    });
}

function blobToDataURL(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("S3Gallery", 2);

        request.onerror = (event) => {
            console.error("Error opening IndexedDB:", event);
            reject(event);
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create the images object store if it doesn't exist
            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "key" });
            }

            // Create the buckets object store if it doesn't exist
            if (!db.objectStoreNames.contains("buckets")) {
                db.createObjectStore("buckets", { keyPath: "alias" });
            }
        };
    });
}

// Bucket saving functions
async function saveBucketConfig(alias, bucketName, region, accessKeyId, secretAccessKey) {
    const db = await openIndexedDB();
    const transaction = db.transaction("buckets", "readwrite");
    const objectStore = transaction.objectStore("buckets");

    const bucketConfig = {
        alias,
        bucketName,
        region,
        accessKeyId,
        secretAccessKey,
    };

    objectStore.put(bucketConfig);
    await transaction.done;
}

async function loadBucketConfigs() {
    const db = await openIndexedDB();
    const tx = db.transaction("buckets", "readonly");
    const store = tx.objectStore("buckets");
    const cursorRequest = store.openCursor();
    const bucketConfigs = [];

    return new Promise((resolve, reject) => {
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                bucketConfigs.push(cursor.value);
                cursor.continue();
            } else {
                resolve(bucketConfigs);
            }
        };

        cursorRequest.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function updateBucketDropdown() {
    const bucketConfigs = await loadBucketConfigs();
    const selectElement = document.getElementById("existing-buckets");

    // Remove all existing options
    selectElement.innerHTML = "";

    // Add a default option
    const defaultOption = document.createElement("option");
    defaultOption.textContent = "Select a bucket";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    selectElement.appendChild(defaultOption);

    // Add options for each bucket config
    for (const config of bucketConfigs) {
        const option = document.createElement("option");
        option.textContent = config.alias;
        option.value = JSON.stringify(config);
        selectElement.appendChild(option);
    }
}

async function loadLastUsedBucketConfig() {
    const db = await openIndexedDB();
    const tx = db.transaction("buckets", "readonly");
    const store = tx.objectStore("buckets");
    const cursor = await store.openCursor(null, "prev");

    if (cursor) {
        return cursor.value;
    }

    return null;
}

async function loadBucketConfigByAlias(alias) {
    const db = await openIndexedDB();
    const tx = db.transaction("buckets", "readonly");
    const store = tx.objectStore("buckets");
    const request = store.get(alias);

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

// Cookie handling functions
function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value};${expires};path=/`;
}

function getCookie(name) {
    const cookieName = `${name}=`;
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookies = decodedCookie.split(';');

    for (let i = 0; i < cookies.length; i++) {
        let c = cookies[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(cookieName) === 0) {
            return c.substring(cookieName.length, c.length);
        }
    }
    return "";
}

async function updateConfig(alias, bucketName, region, accessKeyId, secretAccessKey, imageSize) {
    // Update the global bucketName variable
    window.bucketName = bucketName;

    // Update the S3 client configuration
    AWS.config.update({
        region: region,
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
    });

    // Recreate the S3 client with the new configuration
    s3 = new AWS.S3({apiVersion: '2006-03-01'});
    document.getElementById('bucket-alias').value = alias;
    document.getElementById('bucket-name').value = bucketName;
    document.getElementById('region').value = region;
    document.getElementById('access-key-id').value = accessKeyId;
    document.getElementById('secret-access-key').value = secretAccessKey;
    document.getElementById('gallery-image-size').value = imageSize;

    return new Promise(async (resolve) => {
        versioningEnabled = undefined;
        versioningEnabled = await isVersioningEnabled();

        const prefix = new URLSearchParams(window.location.search).get("prefix") || "";
        renderBreadcrumbs(prefix);
        await listObjects(prefix);

        // Load settings from cookies
        const savedImageSize = getCookie("imageSize");
        if (savedImageSize) {
            document.getElementById("gallery-image-size").value = savedImageSize;
            updateImageSize(savedImageSize);
        }

        // Update the bucket drop-down
        await updateBucketDropdown();

        resolve();
    });
}

// loading screen
function showLoadingScreen() {
    const loadingScreen = document.createElement('div');
    loadingScreen.classList.add('loading-screen');
    loadingScreen.innerHTML = `
    <span class="loading-message">Loading objects...</span>
    <div class="loading-bar"></div>
  `;
    document.body.appendChild(loadingScreen);
    return loadingScreen;
}

// change grid size
function updateImageSize(imageSize = undefined) {
    if (imageSize === undefined) {
        imageSize = document.getElementById("gallery-image-size").value;
    }

    const image = document.querySelectorAll('.image,.folder');
    image.forEach((container) => {
        container.style.maxWidth = `${imageSize}px`;
    })
    const imageContainers = document.querySelectorAll('.image-container');
    imageContainers.forEach((container) => {
        container.style.width = `${imageSize}px`;
        container.style.paddingTop = `${imageSize}px`;
    });
}

document.getElementById('gallery-image-size').addEventListener('input', (event) => {
    const imageSize = event.target.value;
    setCookie('imageSize', imageSize, 30);
    updateImageSize(imageSize);
});

document.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const galleryImageSizeInput = document.getElementById('gallery-image-size');
        const currentValue = parseInt(galleryImageSizeInput.value);
        let newValue;

        if (event.deltaY < 0) {
            // Scroll up: increase value
            newValue = Math.min(currentValue + 16, parseInt(galleryImageSizeInput.max));
        } else {
            // Scroll down: decrease value
            newValue = Math.max(currentValue - 16, parseInt(galleryImageSizeInput.min));
        }

        galleryImageSizeInput.value = newValue;
        setCookie('imageSize', newValue, 30);
        updateImageSize(newValue);
    }
}, {passive: false});

// settings modal
document.getElementById("options-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("settings-modal").classList.remove("hidden");

    function closeModal(event) {
        event.preventDefault();
        document.getElementById("settings-modal").classList.add("hidden");

        document.querySelectorAll(".close-settings").forEach(link => link.removeEventListener("click", closeModal));
        document.getElementById("settings-modal").removeEventListener("click", outsideModalClick);
        document.removeEventListener("keydown", escapeModal);
    }

    function outsideModalClick(event) {
        if (event.target === document.getElementById("settings-modal")) closeModal(event);
    }

    function escapeModal(event) {
        if (event.key === 'Escape') closeModal(event);
    }

    document.querySelectorAll(".close-settings").forEach(link => {
        link.addEventListener("click", closeModal);
    });
    document.getElementById("settings-modal").addEventListener("click", outsideModalClick);
    document.addEventListener("keydown", escapeModal);
});

document.getElementById("save-settings").addEventListener("click", async (event) => {
    event.preventDefault();
    const alias = document.getElementById("bucket-alias").value;
    const bucketName = document.getElementById("bucket-name").value;
    const region = document.getElementById("region").value;
    const accessKeyId = document.getElementById("access-key-id").value;
    const secretAccessKey = document.getElementById("secret-access-key").value;

    await saveBucketConfig(alias, bucketName, region, accessKeyId, secretAccessKey);

    // Save the bucket alias in a cookie
    setCookie("bucket-alias", alias, 30);

    updateConfig(alias, bucketName, region, accessKeyId, secretAccessKey);
    document.getElementById("settings-modal").classList.add("hidden");
});

document.getElementById("existing-buckets").addEventListener("change", (event) => {
    const selectedConfig = JSON.parse(event.target.value);

    document.getElementById("bucket-alias").value = selectedConfig.alias;
    document.getElementById("bucket-name").value = selectedConfig.bucketName;
    document.getElementById("region").value = selectedConfig.region;
    document.getElementById("access-key-id").value = selectedConfig.accessKeyId;
    document.getElementById("secret-access-key").value = selectedConfig.secretAccessKey;
});



// Add the ability to zoom
let imageScale = 1;
let isDragging = false;
let lastMouseX, lastMouseY;
let translateX = 0;
let translateY = 0;
function resetZoom() {
    const modalImage = document.getElementById("modal-image");
    modalImage.style.transform = "scale(1)";
    imageScale = 1;
    translateX = 0;
    translateY = 0;
}
function addDragAndZoomEventHandlers() {
    function imageZoom(event) {
        event.preventDefault();
        if (isDragging) return;

        // Determine the zoom direction (in or out)
        const zoomDirection = event.deltaY < 0 ? 1 : -1;

        // Store the previous scale
        const prevScale = imageScale;

        // Calculate the new scale
        imageScale += zoomDirection * 0.3;

        // Set a minimum and maximum scale
        imageScale = Math.min(Math.max(imageScale, 0.1), 5);

        // Calculate the mouse position relative to the image panel
        const rect = imagePanel.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;

        // Update the translation based on the new scale and mouse position
        translateX = offsetX - (offsetX - translateX) * (imageScale / prevScale);
        translateY = offsetY - (offsetY - translateY) * (imageScale / prevScale);

        if (imageScale <= 1) {
            // Reset the image transform properties when zooming out
            imageScale = 1;
            translateX = 0;
            translateY = 0;
            modalImage.style.transform = "scale(1)";
        } else {
            // Apply the new scale and translation to the image
            modalImage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${imageScale})`;
        }
    }

    function imageGrab(event) {
        event.preventDefault();
        if (imageScale <= 1) return;

        isDragging = true;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        imagePanel.style.cursor = "grabbing";
    }

    function imageDrag(event) {
        event.preventDefault();
        if (!isDragging) return;

        // Calculate the mouse movement delta
        const deltaX = event.clientX - lastMouseX;
        const deltaY = event.clientY - lastMouseY;

        // Update the image position based on the mouse movement
        translateX += deltaX;
        translateY += deltaY;
        modalImage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${imageScale})`;

        // Update the last mouse position
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
    }

    function imageEndDragging(event) {
        event.preventDefault();
        isDragging = false;
        imagePanel.style.cursor = "default";
    }

    const imagePanel = document.querySelector(".image-panel");
    const modalImage = document.getElementById("modal-image");
    modalImage.classList.add("zoomable");
    modalImage.addEventListener("wheel", imageZoom, {passive: false});
    modalImage.addEventListener("mousedown", imageGrab);
    modalImage.addEventListener("mousemove", imageDrag);
    modalImage.addEventListener("mouseup", imageEndDragging);
    modalImage.addEventListener("mouseleave", imageEndDragging);
}

document.addEventListener("DOMContentLoaded", async function () {
    // Load the last used bucket alias from the cookie
    const lastUsedBucketAlias = getCookie("bucket-alias");
    let lastUsedBucketConfig = null;

    if (lastUsedBucketAlias) {
        lastUsedBucketConfig = await loadBucketConfigByAlias(lastUsedBucketAlias);
    }

    if (lastUsedBucketConfig) {
        await updateConfig(
            lastUsedBucketAlias,
            lastUsedBucketConfig.bucketName,
            lastUsedBucketConfig.region,
            lastUsedBucketConfig.accessKeyId,
            lastUsedBucketConfig.secretAccessKey
        );
    }

    addDragAndZoomEventHandlers();
});



class DataStore {
    /**
     * Simple abstraction over IndexedDB with fallback to in-memory data
     */

    constructor() {
        this.useIndexedDB = 'indexedDB' in window;
        this.inMemoryData = {
            hits: [],
            clusters: [],
            meta: {}
        }
    }
    
    async initDB() {
        if (!this.useIndexedDB) {
            console.warn('IndexedDB is not available. Falling back to in-memory data.');
            return;
        } 
        return new Promise((resolve, reject) => {
            const dbRequest = indexedDB.open('cblasterResults', 1);
            dbRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore('meta');
                db.createObjectStore('hits',     { keyPath: 'id' });
                db.createObjectStore('clusters', { keyPath: 'id' });
            }
            dbRequest.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            }
            dbRequest.onerror = () => {
                console.warn('Failed to initialise IndexedDB. Falling back to in-memory data.')
                this.useIndexedDB = false;
                resolve();
            }
        })
    }
    
    async saveData(storeName, data) {
        if (this.useIndexedDB) {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            if (Array.isArray(data)) {
                data.forEach(item => store.put(item));
            } else {
                store.put(data, 'meta');
            }
            return transaction.complete;
        } else {
            if (storeName === 'meta') {
                Object.assign(this.inMemoryData.meta, data);
            } else {
                this.inMemoryData[storeName] = data;
            }
        }
    }
    
    async getData(storeName, key = null) {
        if (this.useIndexedDB) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName]);
                const store = transaction.objectStore(storeName);
                const request = key !== null ? store.get(key) : store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } else {
            if (storeName === 'meta') {
                return key !== null ? this.inMemoryData.meta[key] : this.inMemoryData.meta;
            } else {
                return key !== null ? this.inMemoryData[storeName][key] : this.inMemoryData[storeName];
            }
        }
    }
}

function makeGeneSVGPath(gene, svgHeight, minStart, arrowHeight, arrowHeadWidth) {
    const yOffset = arrowHeight / 2;
    const direction = gene.strand >= 0 ? 1 : -1;
    const arrowStart = gene.start - minStart;
    const arrowEnd = gene.end - minStart;
    const bodyEnd = arrowEnd - direction * arrowHeadWidth;
    if (gene.strand === 1) {
        return [
            `M ${arrowStart},0`, // Top-left corner
            `L ${bodyEnd},0`,   // Top-right corner (before head)
            `L ${arrowEnd},${yOffset}`,                  // Arrowhead tip
            `L ${bodyEnd},${arrowHeight}`, // Bottom-right corner (before head)
            `L ${arrowStart},${arrowHeight}`, // Bottom-left corner
            "Z" // Close the path
        ].join(" ");
    } else {
        return [
            `M ${arrowStart},${yOffset}`,
            `L ${arrowStart + arrowHeadWidth},0`,
            `L ${arrowEnd},0`,
            `L ${arrowEnd},${arrowHeight}`,
            `L ${arrowStart + arrowHeadWidth},${arrowHeight}`,
            "Z"
        ].join(" ");
    }
}

function makeClusterSVG(genes, arrowHeight=100, arrowHeadWidth=50) {
    const svgNS = "http://www.w3.org/2000/svg";
    const maxEnd = Math.max(...genes.map(g => g.end));
    const minStart = Math.min(...genes.map(g => g.start));
    const svgWidth = maxEnd - minStart + 50;
    const svgHeight = 500;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    for (const gene of genes) {
        const pathElement = document.createElementNS(svgNS, "path");
        const path = makeGeneSVGPath(gene, svgHeight, minStart, arrowHeight=svgHeight, arrowHeadWidth=500);
        pathElement.classList.add(`gene-${gene.name}`);
        pathElement.setAttribute("d", path);
        pathElement.setAttribute("fill", "#007BFF");
        pathElement.setAttribute("stroke", "#000");
        pathElement.setAttribute("stroke-width", "1");
        svg.appendChild(pathElement);
    }
    
    const serialiser = new XMLSerializer();
    return serialiser.serializeToString(svg);
}

const table = document.getElementById("grid-container");
const header = document.getElementById("grid-header-row");

function shortenOrganismName(name) {
    const parts = name.split(" ");
    if (parts.length < 2) {
        return name;
    }
    const [genus, species] = parts;
    return `${genus.charAt(0)}. ${species}`;
}

function scoreToRGBA(score) {
    if (score < 0 || score > 1) {
        throw new Error("Score must be between 0 and 1");
    }
    const startColor = { r: 255, g: 255, b: 255 };
    const endColor = { r: 8, g: 48, b: 107 };
    const r = Math.round(startColor.r + (endColor.r - startColor.r) * score);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * score);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * score);
    return [r, g, b];
}
function calculateBrightness(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}
function getContrastingTextColor(r, g, b) {
    const brightness = calculateBrightness(r, g, b);
    return brightness > 128 ? "#000" : "#fff"; // Black text for bright backgrounds, white for dark
}

async function createClusterNew(store, clusterIds, clusteringIdx) {
    const data = await store.getData('clusters', clusterIds[0]);

    const template = document.getElementById("cluster-template").content.cloneNode(true);
    template.querySelector(".organism-name").textContent = data.organism_name;
    template.querySelector(".organism-strain").textContent = data.organism_strain;
    template.querySelector(".scaffold-name").textContent = data.scaffold;
    template.querySelector(".scaffold-start").textContent = data.start;
    template.querySelector(".scaffold-end").textContent = data.end;
    template.querySelector(".cluster-length").textContent = data.end - data.start;
    template.querySelector(".cluster-score").textContent = parseFloat(data.score).toFixed(2);

    const row = template.querySelector(".cluster-row");
    const toggle = template.querySelector(".toggle");
    if (clusterIds.length <= 1) {
        toggle.classList.add("hidden");
    } else {
        toggle.textContent = `▼ ${clusterIds.length}`;
    }
    const pattern = template.querySelector(".pattern");
    await data.hits.forEach(async (hits) => {
        const cell = document.createElement("div");
        cell.textContent = hits.length;
        cell.className = `pattern-square ${hits.length > 0 ? "blue" : "hidden"}`;
        const hitData = await Promise.all(hits.map(async (hit) => {
            return await store.getData('hits', hit);
        }))
        const maxScore = Math.max(hitData.map(hit => hit.identity / 100));
        const [r, g, b] = scoreToRGBA(maxScore);
        cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 1)`;
        cell.style.color = getContrastingTextColor(r, g, b);
        pattern.appendChild(cell);
    })
    
    toggle.addEventListener("click", () => {
        const isOpen = toggle.classList.contains("expanded"); 
        
        if (isOpen) {
            toggle.classList.remove("expanded");
            toggle.textContent = `▼ ${clusterIds.length}`;
            // Remove following rows until next cluster/pattern-row element
            while (row.nextElementSibling && !row.nextElementSibling.classList.contains("cluster-row")) {
                row.nextElementSibling.remove();
            }
        } else {
            if (clusterIds.length > 1) {
                for (let i = 1; i < clusterIds.length; i++) {
                    // TODO wrap this in a document fragment so we can batch insert
                    // should prevent weird streaming behaviour on safari
                    createMemberNew(store, clusterIds[i], row);
                }
            }
            toggle.classList.add("expanded");
            toggle.textContent = `▲ ${clusterIds.length}`;
        }
    });
 

    table.appendChild(template);
}

async function createMemberNew(store, clusterId, parentRow) {
    const data = await store.getData('clusters', clusterId);
    
    const template = document.getElementById("member-template").content.cloneNode(true);
    template.querySelector(".organism-name").textContent = data.organism_name;
    template.querySelector(".organism-strain").textContent = data.organism_strain;
    template.querySelector(".scaffold-name").textContent = data.scaffold;
    template.querySelector(".scaffold-start").textContent = data.start;
    template.querySelector(".scaffold-end").textContent = data.end;
    template.querySelector(".cluster-length").textContent = data.end - data.start;
    template.querySelector(".cluster-score").textContent = parseFloat(data.score).toFixed(2);

    const pattern = template.querySelector(".pattern");
    await data.hits.forEach(async (hits) => {
        const cell = document.createElement("div");
        cell.textContent = hits.length;
        cell.className = `pattern-square ${hits.length > 0 ? "blue" : "hidden"}`;
        const hitData = await Promise.all(hits.map(async (hit) => {
            return await store.getData('hits', hit);
        }))
        // cell.style.opacity = Math.max(hitData.map(hit => hit.identity / 100))
        const maxScore = Math.max(hitData.map(hit => hit.identity / 100));
        const [r, g, b] = scoreToRGBA(maxScore);
        cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 1)`;
        cell.style.color = getContrastingTextColor(r, g, b);
        pattern.appendChild(cell);        
    })

    table.insertBefore(template, parentRow.nextElementSibling);
}

document.addEventListener("DOMContentLoaded", async () => {
    const dataURL = 'testdata_bacteria.json'; 
    const response = await fetch(dataURL);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${dataURL}`);
    }
    const newData = await response.json(); 

    
    const dataStore = new DataStore();
    await dataStore.initDB();
    await dataStore.saveData('hits', newData.hits);
    await dataStore.saveData('clusters', newData.clusters);

    // Sort by score
    const scores = await Promise.all(newData.clustering.map(async x => {
        const d = await dataStore.getData('clusters', x[0]);
        return [d.score, x];
    }))
    scores.sort((a, b) => b[0] - a[0])
    const clustering = scores.map(x => x[1]);
   
    for (const [idx, cluster] of clustering.entries()) {
        createClusterNew(dataStore, cluster, idx);
    }
   
    for (const query of newData.query.queries) {
        const span = document.createElement("span");
        span.textContent = query.name;
        header.querySelector(".pattern").appendChild(span);
    }
})
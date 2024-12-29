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
    
    async getHitCellData(clusterId, queryId) {
        const clusterData = await this.getData('clusters', clusterId);
        const hitIndices = clusterData.hits[queryId];
        const hitData = await Promise.all(hitIndices.map(hitId => this.getData('hits', hitId)));
        return hitData;
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

async function createClusterNew(store, clusterIds, table) {
    const data = await store.getData('clusters', clusterIds[0]);

    const template = document.getElementById("cluster-template").content.cloneNode(true);
    template.querySelector(".organism-name").textContent = data.organism_name;
    template.querySelector(".organism-strain").textContent = data.organism_strain;
    template.querySelector(".scaffold-name").innerHTML = `<a href="https://www.ncbi.nlm.nih.gov/nuccore/${data.scaffold}?report=graph&from=${data.start}&to=${data.end}">${data.scaffold}</a>`
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
    await data.hits.forEach(async (hits, queryId) => {
        const cell = document.createElement("div");
        cell.dataset.clusterId = clusterIds[0];
        cell.dataset.queryIndex = queryId;
        cell.textContent = hits.length;
        cell.className = `pattern-square ${hits.length > 0 ? "blue" : "hidden"}`;
        const hitData = await Promise.all(hits.map(async (hit) => {
            return await store.getData('hits', hit);
        }))
        if (hitData.length > 0) {
            const maxScore = Math.max(...hitData.map(hit => parseFloat(hit.identity) / 100));
            const [r, g, b] = scoreToRGBA(maxScore);
            cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 1)`;
            cell.style.color = getContrastingTextColor(r, g, b);
        }
        pattern.appendChild(cell);
    })
    
    toggle.addEventListener("click", async () => {
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
                const fragment = new DocumentFragment();
                for (let i = 1; i < clusterIds.length; i++) {
                    const member = await createMemberNew(store, clusterIds[i], row);
                    fragment.appendChild(member);
                }
                table.insertBefore(fragment, row.nextElementSibling);;
                
                const newMemberRows = []
                let nextSibling = row.nextElementSibling;
                while (nextSibling && !nextSibling.classList.contains("cluster-row")) {
                    if (nextSibling.classList.contains('member-row')) {
                        newMemberRows.push(nextSibling);
                    }
                    nextSibling = nextSibling.nextElementSibling;
                }

                newMemberRows.forEach((member, index) => {
                    member.animate(
                        [
                            { opacity: 0, transform: 'translateY(-20px)' },
                            { opacity: 1, transform: 'translateY(0)' }
                        ],
                        {
                            duration: 200,
                            delay: index * 15,
                            easing: 'ease-out',
                            fill: 'forwards'
                        }
                    )
                });
            }
            toggle.classList.add("expanded");
            toggle.textContent = `▲ ${clusterIds.length}`;
        }
    });
    
    return template;
}

async function createMemberNew(store, clusterId) {
    const data = await store.getData('clusters', clusterId);
    
    const template = document.getElementById("member-template").content.cloneNode(true);

    const clusterRow = template.querySelector(".member-row")
    clusterRow.style.opacity = '0';
    clusterRow.style.transform = 'translateY(-20px)';
    
    template.querySelector(".organism-name").textContent = data.organism_name;
    template.querySelector(".organism-strain").textContent = data.organism_strain;
    template.querySelector(".scaffold-name").innerHTML = `<a href="https://www.ncbi.nlm.nih.gov/nuccore/${data.scaffold}?report=graph&from=${data.start}&to=${data.end}">${data.scaffold}</a>`
    template.querySelector(".scaffold-start").textContent = data.start;
    template.querySelector(".scaffold-end").textContent = data.end;
    template.querySelector(".cluster-length").textContent = data.end - data.start;
    template.querySelector(".cluster-score").textContent = parseFloat(data.score).toFixed(2);

    const pattern = template.querySelector(".pattern");
    await data.hits.forEach(async (hits, queryId) => {
        const cell = document.createElement("div");
        cell.dataset.clusterId = clusterId;
        cell.dataset.queryIndex = queryId;
        cell.textContent = hits.length;
        cell.className = `pattern-square ${hits.length > 0 ? "blue" : "hidden"}`;
        const hitData = await Promise.all(hits.map(async (hit) => {
            return await store.getData('hits', hit);
        }))
        if (hitData.length > 0) {
            const maxScore = Math.max(hitData.map(hit => hit.identity / 100));
            const [r, g, b] = scoreToRGBA(maxScore);
            cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 1)`;
            cell.style.color = getContrastingTextColor(r, g, b);
        }
        pattern.appendChild(cell);        
    })
    return template;
}

function showTooltip(cell, hitData, clusterData) {
    let tooltip = document.querySelector(".tooltip");
    if (!tooltip) {
        const template = document.getElementById("tooltip-template").content.cloneNode(true);
        document.body.appendChild(template);
        tooltip = document.querySelector(".tooltip");
    }
    
    tooltip.querySelector('.tooltip-organism-name').textContent = clusterData.organism_name;
    tooltip.querySelector('.tooltip-organism-strain').textContent = clusterData.organism_strain;
    tooltip.querySelector(".tooltip-scaffold").innerHTML = `<a href="https://www.ncbi.nlm.nih.gov/nuccore/${clusterData.scaffold}?report=graph&from=${clusterData.start}&to=${clusterData.end}">${clusterData.scaffold}</a>`
    
    const tooltipRows = tooltip.querySelector(".tooltip-rows");
    tooltipRows.replaceChildren();

    const headerRow = document.getElementById("tooltip-row-template").content.cloneNode(true);
    headerRow.querySelector('.tooltip-row').classList.add("tooltip-rows-header");
    tooltipRows.appendChild(headerRow);
    
    const fragment = new DocumentFragment();
    hitData.forEach(hit => {
        row = document.getElementById("tooltip-row-template").content.cloneNode(true);
        row.querySelector(".tooltip-name").textContent = hit.name;
        row.querySelector(".tooltip-start").textContent = hit.start;
        row.querySelector(".tooltip-end").textContent = hit.end;
        row.querySelector(".tooltip-identity").textContent = parseFloat(hit.identity).toFixed(2);
        row.querySelector(".tooltip-coverage").textContent = parseFloat(hit.coverage).toFixed(2);
        row.querySelector(".tooltip-bitscore").textContent = hit.bitscore;
        row.querySelector(".tooltip-evalue").textContent = parseFloat(hit.evalue).toFixed(2);
        fragment.appendChild(row);
    })
    tooltipRows.appendChild(fragment)
    
    const rect = cell.getBoundingClientRect();
    // TODO this is broken when scrolled
    // need to fix positioning so 1) always visible in viewport, 2) anchored better to cell
    // also need it to disappear automatically after a time
    tooltip.style.left = `${rect.left - window.scrollX + 10}px`;
    tooltip.style.top = `${rect.top - window.scrollY + 10}px`;
    tooltip.style.opacity = 1;
    tooltip.style.pointerEvents = 'auto';
}


async function loadData() {
    // Check if data is embedded in the HTML
    let newData;
    const embeddedDataElement = document.getElementById('data-json');
    if (embeddedDataElement) {
        newData = JSON.parse(embeddedDataElement.textContent);
    } else {
        const dataURL = 'testdata_bacteria.json';
        const response = await fetch(dataURL);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${dataURL}`);
        }
        newData = await response.json();
    }
    return newData;
}


document.addEventListener("DOMContentLoaded", async () => {
    const table = document.getElementById("grid-container");
    const header = document.getElementById("grid-header-row");

    const newData = await loadData();

    const dataStore = new DataStore();
    await dataStore.initDB();
    await dataStore.saveData('hits', newData.hits);
    await dataStore.saveData('clusters', newData.clusters);
    
    document.addEventListener('mouseover', async (event) => {
        const cell = event.target.closest('.pattern-square');
        if (!cell) return;
        const clusterId = parseInt(cell.dataset.clusterId);
        const queryId   = parseInt(cell.dataset.queryIndex);
        const hitData = await dataStore.getHitCellData(clusterId, queryId);
        const clusterData = await dataStore.getData('clusters', clusterId)
        // TODO shouldn't requery the database here for cluster data since
        //      we already do in getHitCellData
        showTooltip(cell, hitData, clusterData);
    });
    
    // Sort by score
    const scores = await Promise.all(newData.clustering.map(async x => {
        const d = await dataStore.getData('clusters', x[0]);
        return [d.score, x];
    }))
    scores.sort((a, b) => b[0] - a[0])
    const clustering = scores.map(x => x[1]);
   
    const fragment = new DocumentFragment();
    for (const [idx, cluster] of clustering.entries()) {
        const element = await createClusterNew(dataStore, cluster, table);
        fragment.appendChild(element);
    }
    table.appendChild(fragment);
   
    for (const query of newData.query.queries) {
        const span = document.createElement("span");
        span.textContent = query.name;
        header.querySelector(".pattern").appendChild(span);
    }
})
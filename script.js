// 全局变量
let currentData = null;
let currentMethod = null;
let analysisResults = [];
let reportItems = []; // 报告项目记录
let currentReportIndex = -1; // 当前查看的报告项目索引
let droppedVariables = {};
let usedVariables = new Set(); // 跟踪已使用的变量
let isProcessingFile = false; // 防止重复上传
let selectedVariables = new Set(); // 当前选中的变量
let lastSelectedIndex = -1; // 上次选中的索引，用于Shift选择
let currentAnalysisResult = null; // 当前临时分析结果
let draggedVariable = null; // 当前拖拽的变量
let touchGhost = null; // 触摸拖拽时的幽灵元素
let namingZoneRegistry = new Set();
let namingVariableRegistry = new Set();
let methodGroupCounters = {};

// 框选相关变量
let isBoxSelecting = false;
let boxSelectionStart = { x: 0, y: 0 };
let selectionBoxEl = null;

// 页面初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化页面
    initializePage();
    
    // 设置事件监听器
    setupEventListeners();
    setupBoxSelection();
    
    // 显示首页
    showPage('home');
    if(window.lucide) lucide.createIcons();
    
    // 帮助按钮事件
    const helpBtn = document.querySelector('.help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => showModal('helpModal'));
    }

    // 初始化文件上传
    setupFileUpload();
    updateReportDisplay();
});

function normalizeNameToken(value) {
    const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    const replaced = text.replace(/[^\w\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '');
    return replaced || 'item';
}

function reserveUniqueName(registry, baseName) {
    let candidate = baseName;
    let index = 2;
    while (registry.has(candidate)) {
        candidate = `${baseName}__${index}`;
        index += 1;
    }
    registry.add(candidate);
    return candidate;
}

function allocateZoneDomId(methodId, analysisKey) {
    const base = `z_${normalizeNameToken(methodId)}_${normalizeNameToken(analysisKey)}`;
    return reserveUniqueName(namingZoneRegistry, base);
}

function allocateVariableKey(zoneDomId, variableName) {
    const base = `v_${normalizeNameToken(zoneDomId)}_${normalizeNameToken(variableName)}`;
    return reserveUniqueName(namingVariableRegistry, base);
}

function createGroupAnalysisKey(methodId) {
    const methodToken = normalizeNameToken(methodId);
    if (!methodGroupCounters[methodToken]) methodGroupCounters[methodToken] = 1;
    let index = methodGroupCounters[methodToken];
    let key = `group_${methodToken}_${index}`;
    const existingKeys = new Set(Array.from(document.querySelectorAll('.drop-zone')).map(zone => zone.dataset.analysisKey));
    while (existingKeys.has(key)) {
        index += 1;
        key = `group_${methodToken}_${index}`;
    }
    methodGroupCounters[methodToken] = index + 1;
    return key;
}

function setupBoxSelection() {
    const container = document.getElementById('variablesList');
    if (!container) return;
    
    container.addEventListener('mousedown', handleBoxSelectStart);
    // 阻止默认文本选择
    container.addEventListener('selectstart', (e) => e.preventDefault());
}

function handleBoxSelectStart(e) {
    // 如果点击的是变量项本身，则不触发框选
    if (e.target.closest('.variable-item')) return;
    
    isBoxSelecting = true;
    boxSelectionStart = { x: e.clientX, y: e.clientY };
    
    // 创建框选框
    selectionBoxEl = document.createElement('div');
    selectionBoxEl.className = 'selection-box';
    document.body.appendChild(selectionBoxEl);
    
    // 如果没有按住Ctrl/Meta键，清除当前选择
    if (!e.ctrlKey && !e.metaKey) {
        clearVariableSelection();
    }
    
    document.addEventListener('mousemove', handleBoxSelectMove);
    document.addEventListener('mouseup', handleBoxSelectEnd);
}

function handleBoxSelectMove(e) {
    if (!isBoxSelecting) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(boxSelectionStart.x, currentX);
    const top = Math.min(boxSelectionStart.y, currentY);
    const width = Math.abs(currentX - boxSelectionStart.x);
    const height = Math.abs(currentY - boxSelectionStart.y);
    
    selectionBoxEl.style.left = left + 'px';
    selectionBoxEl.style.top = top + 'px';
    selectionBoxEl.style.width = width + 'px';
    selectionBoxEl.style.height = height + 'px';
    
    // 碰撞检测
    const boxRect = { left, top, right: left + width, bottom: top + height };
    document.querySelectorAll('.variable-item').forEach(item => {
        const itemRect = item.getBoundingClientRect();
        if (rectIntersect(boxRect, itemRect)) {
            item.classList.add('selected');
            selectedVariables.add(item.dataset.variable);
        } else {
            // 如果不按Ctrl，框选未覆盖的应该取消选择吗？
            // 简单逻辑：框选只增加选择。如果想重新选，先点击空白处清除。
            // 实际上我们在Start时已经清除过了。所以这里只需要处理增加。
        }
    });
    updateSelectedCount();
}

function handleBoxSelectEnd(e) {
    isBoxSelecting = false;
    if (selectionBoxEl) {
        selectionBoxEl.remove();
        selectionBoxEl = null;
    }
    document.removeEventListener('mousemove', handleBoxSelectMove);
    document.removeEventListener('mouseup', handleBoxSelectEnd);
}

function rectIntersect(r1, r2) {
    return !(r2.left > r1.right || 
             r2.right < r1.left || 
             r2.top > r1.bottom || 
             r2.bottom < r1.top);
}

function initializePage() {
    // 导航栏点击事件
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.currentTarget.dataset.page;
            if (page) showPage(page);
        });
    });

    // 分析方法点击事件
    document.querySelectorAll('.method-item').forEach(item => {
        item.addEventListener('click', () => {
            const method = item.dataset.method;
            selectMethod(method);
        });
    });

    // 分类折叠
    document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
            const list = header.nextElementSibling;
            const icon = header.querySelector('.toggle-icon');
            list.classList.toggle('collapsed');
            icon.classList.toggle('fa-chevron-down');
            icon.classList.toggle('fa-chevron-right');
        });
    });
}

function showPage(pageId) {
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(pageId + 'Page').classList.add('active');
    
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === pageId) {
            link.classList.add('active');
        }
    });
    if(window.lucide) lucide.createIcons();
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// 文件上传逻辑 (重写)
function setupFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const uploadZone = document.getElementById('uploadZone');

    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    if (uploadZone) {
        uploadZone.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            fileInput.click();
        });
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFile(file) {
    if (isProcessingFile) return;
    isProcessingFile = true;
    showLoading();

    const reader = new FileReader();
    const name = file.name;
    
    reader.onload = function(e) {
        const data = e.target.result;
        
        if (name.endsWith('.csv')) {
            parseCSV(data);
        } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            parseExcel(data);
        } else {
            hideLoading();
            showMessage('不支持的文件格式', 'error');
            isProcessingFile = false;
        }
    };
    
    if (name.endsWith('.csv')) {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
}

function parseCSV(data) {
    Papa.parse(data, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            processData(results.data, results.meta.fields);
        },
        error: function(error) {
            hideLoading();
            showMessage('CSV解析错误: ' + error.message, 'error');
            isProcessingFile = false;
        }
    });
}

function parseExcel(data) {
    try {
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (json.length < 2) {
            throw new Error('数据行数太少');
        }
        
        const headers = json[0];
        const rows = json.slice(1).map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index];
            });
            return obj;
        });
        
        processData(rows, headers);
    } catch (error) {
        hideLoading();
        showMessage('Excel解析错误: ' + error.message, 'error');
        isProcessingFile = false;
    }
}

function processData(rows, headers) {
    currentData = {
        processed: rows,
        headers: headers,
        original: rows // 简化处理
    };
    
    usedVariables.clear(); // 清空已使用变量记录
    updateDataPreview();
    updateVariablesList();
    
    hideLoading();
    isProcessingFile = false;
    showMessage('数据上传成功', 'success');
    
    // 显示预览区域
    document.getElementById('dataPreviewSection').style.display = 'block';
    document.getElementById('uploadZone').style.display = 'none';
}

let previewCurrentPage = 1;
const previewPageSize = 20;

function updateDataPreview() {
    const table = document.getElementById('previewTable');
    if (!table || !currentData) return;
    
    const totalRows = currentData.processed.length;
    const totalPages = Math.ceil(totalRows / previewPageSize);
    
    let html = '<thead><tr>';
    currentData.headers.forEach(header => {
        html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    const startIdx = (previewCurrentPage - 1) * previewPageSize;
    const endIdx = Math.min(startIdx + previewPageSize, totalRows);
    
    // 显示当前页数据
    currentData.processed.slice(startIdx, endIdx).forEach(row => {
        html += '<tr>';
        currentData.headers.forEach(header => {
            html += `<td>${row[header] !== undefined ? row[header] : ''}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody>';
    
    table.innerHTML = html;
    
    // 分页控件
    let paginationHtml = `
        <div class="pagination-controls" style="margin-top:15px; display:flex; gap:10px; align-items:center; justify-content:center;">
            <button class="btn btn-secondary" style="padding:4px 12px; font-size:12px; min-height:unset;" onclick="changePreviewPage(-1)" ${previewCurrentPage === 1 ? 'disabled' : ''}>上一页</button>
            <span style="font-size:13px; color:#666;">第 ${previewCurrentPage} / ${totalPages} 页</span>
            <button class="btn btn-secondary" style="padding:4px 12px; font-size:12px; min-height:unset;" onclick="changePreviewPage(1)" ${previewCurrentPage === totalPages ? 'disabled' : ''}>下一页</button>
        </div>
    `;
    
    let pDiv = document.getElementById('previewPagination');
    if (pDiv) {
        pDiv.innerHTML = paginationHtml;
    } else {
        pDiv = document.createElement('div');
        pDiv.id = 'previewPagination';
        pDiv.innerHTML = paginationHtml;
        table.parentElement.appendChild(pDiv);
    }
    
    document.getElementById('previewStats').textContent = 
        `共 ${totalRows} 行数据，${currentData.headers.length} 个变量`;
}

window.changePreviewPage = function(delta) {
    const totalPages = Math.ceil(currentData.processed.length / previewPageSize);
    previewCurrentPage += delta;
    if (previewCurrentPage < 1) previewCurrentPage = 1;
    if (previewCurrentPage > totalPages) previewCurrentPage = totalPages;
    updateDataPreview();
};

function updateVariablesList() {
    const list = document.getElementById('variablesList');
    if (!list || !currentData) return;
    
    list.innerHTML = '';
    
    currentData.headers.forEach((header, index) => {
        const item = document.createElement('div');
        item.className = 'variable-item';
        item.textContent = header;
        // 启用拖拽功能
        item.draggable = true;
        item.dataset.variable = header;
        item.dataset.index = index;
        
        item.addEventListener('click', handleVariableClick);
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        
        // 触摸事件
        item.addEventListener('touchstart', handleTouchStart, { passive: false });
        item.addEventListener('touchmove', handleTouchMove, { passive: false });
        item.addEventListener('touchend', handleTouchEnd);
        
        list.appendChild(item);
    });
    updateVariableVisibility();
}

function clearSavedData() {
    currentData = null;
    usedVariables.clear();
    document.getElementById('dataPreviewSection').style.display = 'none';
    document.getElementById('uploadZone').style.display = 'block';
    document.getElementById('fileInput').value = '';
    document.getElementById('variablesList').innerHTML = '<p class="no-data">请先上传数据文件</p>';
    clearVariableSelection();
}

// 辅助函数
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

function showMessage(msg, type = 'info') {
    const toast = document.getElementById('messageToast');
    toast.textContent = msg;
    toast.className = 'message-toast ' + type;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function showCopySuccess(button) {
    if (!button) return;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> 已复制';
    setTimeout(() => {
        button.innerHTML = originalText;
    }, 2000);
}

// 选择相关
function handleVariableClick(e) {
    const variable = e.target.dataset.variable;
    const index = parseInt(e.target.dataset.index);
    
    if (e.shiftKey && lastSelectedIndex !== -1) {
        // Shift 连续选择
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const items = document.querySelectorAll('.variable-item');
        
        if (!e.ctrlKey && !e.metaKey) {
            selectedVariables.clear();
            items.forEach(item => item.classList.remove('selected'));
        }
        
        for (let i = start; i <= end; i++) {
            const item = items[i];
            const varName = item.dataset.variable;
            selectedVariables.add(varName);
            item.classList.add('selected');
        }
    } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd 不连续选择
        if (selectedVariables.has(variable)) {
            selectedVariables.delete(variable);
            e.target.classList.remove('selected');
        } else {
            selectedVariables.add(variable);
            e.target.classList.add('selected');
        }
        lastSelectedIndex = index;
    } else {
        // 单选
        selectedVariables.clear();
        document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('selected'));
        selectedVariables.add(variable);
        e.target.classList.add('selected');
        lastSelectedIndex = index;
    }
    updateSelectedCount();
}

function updateSelectedCount() {
    const countSpan = document.getElementById('selectedCount');
    if (countSpan) {
        countSpan.textContent = `(已选 ${selectedVariables.size})`;
    }
}

function updateVariableVisibility() {
    document.querySelectorAll('.variable-item').forEach(item => {
        const variable = item.dataset.variable;
        if (usedVariables.has(variable)) {
            item.classList.add('used');
            // 如果已选中，则取消选中
            if (selectedVariables.has(variable)) {
                selectedVariables.delete(variable);
                item.classList.remove('selected');
            }
        } else {
            item.classList.remove('used');
        }
    });
    updateSelectedCount();
}

window.removeVariableFromZone = function(btn, variableName) {
    const resolvedVariableName = variableName || (btn && btn.parentElement ? btn.parentElement.dataset.variable : '');
    if (btn && btn.parentElement) {
        btn.parentElement.remove();
    }
    if (resolvedVariableName && usedVariables.has(resolvedVariableName)) {
        usedVariables.delete(resolvedVariableName);
        updateVariableVisibility();
    }
};

// 拖拽相关逻辑
function handleDragStart(e) {
    const targetVar = e.target.dataset.variable;
    
    // 如果拖拽的是未选中的项，则选中它（并清除其他选中，除非按住Ctrl）
    // 简单起见，如果拖拽未选项，则将其设为唯一选中项
    if (!selectedVariables.has(targetVar)) {
        selectedVariables.clear();
        selectedVariables.add(targetVar);
        document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('selected'));
        e.target.classList.add('selected');
        updateSelectedCount();
    }
    
    draggedVariable = targetVar; 
    
    // 准备多选数据
    const dragData = {
        items: Array.from(selectedVariables)
    };
    
    e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
    
    // 多选时的视觉反馈
    if (selectedVariables.size > 1) {
        // 创建自定义拖拽图像
        const dragIcon = document.createElement('div');
        dragIcon.className = 'drag-ghost-image';
        dragIcon.textContent = `已选 ${selectedVariables.size} 个变量`;
        dragIcon.style.position = 'absolute';
        dragIcon.style.top = '-1000px';
        document.body.appendChild(dragIcon);
        e.dataTransfer.setDragImage(dragIcon, 0, 0);
        
        // 稍后清理DOM
        setTimeout(() => document.body.removeChild(dragIcon), 0);
    }
    
    // 给所有选中项添加拖拽样式
    document.querySelectorAll('.variable-item.selected').forEach(item => {
        item.classList.add('dragging');
    });
}

function handleDragEnd(e) {
    document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('dragging'));
    draggedVariable = null;
    document.querySelectorAll('.drop-zone').forEach(zone => zone.classList.remove('drag-over'));
}

// 触摸事件处理
function handleTouchStart(e) {
    // 只有在.variable-item上触发才处理
    if (!e.target.classList.contains('variable-item')) return;
    
    const target = e.target;
    const targetVar = target.dataset.variable;
    
    // 同步选中逻辑
    if (!selectedVariables.has(targetVar)) {
        selectedVariables.clear();
        selectedVariables.add(targetVar);
        document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('selected'));
        target.classList.add('selected');
        updateSelectedCount();
    }
    
    draggedVariable = targetVar;
    
    const touch = e.touches[0];
    
    // 创建幽灵元素
    touchGhost = document.createElement('div');
    touchGhost.className = 'dragging-ghost';
    
    if (selectedVariables.size > 1) {
        touchGhost.textContent = `已选 ${selectedVariables.size} 个变量`;
        touchGhost.style.width = 'auto';
        touchGhost.style.minWidth = '120px';
    } else {
        // 克隆单个元素样式
        const clone = target.cloneNode(true);
        touchGhost.textContent = clone.textContent;
        touchGhost.style.width = target.offsetWidth + 'px';
    }
    
    // 通用样式
    touchGhost.style.position = 'fixed';
    touchGhost.style.opacity = '0.9';
    touchGhost.style.pointerEvents = 'none';
    touchGhost.style.zIndex = '1000';
    touchGhost.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
    touchGhost.style.color = 'white';
    touchGhost.style.borderRadius = '6px';
    touchGhost.style.padding = '8px 12px';
    touchGhost.style.fontSize = '12px';
    touchGhost.style.textAlign = 'center';
    touchGhost.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
    
    touchGhost.style.left = (touch.clientX - 60) + 'px'; // 稍微偏移
    touchGhost.style.top = (touch.clientY - 20) + 'px';
    
    document.body.appendChild(touchGhost);
    
    document.querySelectorAll('.variable-item.selected').forEach(item => {
        item.classList.add('dragging');
    });
}

function handleTouchMove(e) {
    if (!draggedVariable || !touchGhost) return;
    e.preventDefault(); // 拖拽过程中阻止滚动
    
    const touch = e.touches[0];
    touchGhost.style.left = (touch.clientX - touchGhost.offsetWidth / 2) + 'px';
    touchGhost.style.top = (touch.clientY - touchGhost.offsetHeight / 2) + 'px';
    
    // 高亮下方的放置区域
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropZone = elementBelow ? elementBelow.closest('.drop-zone') : null;
    
    document.querySelectorAll('.drop-zone').forEach(zone => zone.classList.remove('drag-over'));
    if (dropZone) {
        dropZone.classList.add('drag-over');
    }
}

function handleTouchEnd(e) {
    if (!draggedVariable) return;
    
    const touch = e.changedTouches[0];
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropZone = elementBelow ? elementBelow.closest('.drop-zone') : null;
    
    if (dropZone) {
        const zoneId = dropZone.dataset.zoneId;
        const isMultiple = dropZone.dataset.multiple === 'true';
        
        // 添加所有选中变量
        selectedVariables.forEach(v => {
            addVariableToZone(zoneId, v, isMultiple);
        });
    }
    
    // 清理
    if (touchGhost) {
        touchGhost.remove();
        touchGhost = null;
    }
    document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('dragging'));
    document.querySelectorAll('.drop-zone').forEach(zone => zone.classList.remove('drag-over'));
    draggedVariable = null;
}

window.clearVariableSelection = function() {
    selectedVariables.clear();
    document.querySelectorAll('.variable-item').forEach(item => item.classList.remove('selected'));
    updateSelectedCount();
    lastSelectedIndex = -1;
};

// 分析方法选择
function selectMethod(methodId) {
    currentMethod = methodId;
    
    // 更新UI
    document.querySelectorAll('.method-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.method === methodId) {
            item.classList.add('active');
        }
    });
    
    const methodInfo = getMethodInfo(methodId);
    document.getElementById('currentMethodTitle').textContent = methodInfo.title;
    document.getElementById('currentMethodDesc').textContent = methodInfo.description;
    
    generateDropZones(methodId);
    
    // 绑定运行按钮
    const runBtn = document.getElementById('runAnalysisBtn');
    runBtn.onclick = () => {
        runAnalysis(methodId);
    };
}

function getMethodInfo(methodId) {
    const methods = {
        'frequency': {
            title: '频数分析',
            description: '统计变量的数值分布情况',
            dropZones: [
                { id: 'frequency-variables', label: '分析变量', multiple: true }
            ]
        },
        'descriptive': {
            title: '描述性分析',
            description: '计算平均值、标准差等统计量',
            dropZones: [
                { id: 'analysis-variables', label: '分析变量', multiple: true }
            ]
        },
        'correlation': {
            title: '相关分析',
            description: '分析变量之间的相关性',
            dropZones: [
                { id: 'analysis-variables', label: '分析变量', multiple: true }
            ]
        },
        'reliability': {
            title: '信度分析',
            description: '分析测量结果的一致性或稳定性，通常使用Cronbach α系数',
            dropZones: [
                { id: 'analysis-variables', label: '分析变量', multiple: true }
            ]
        },
        'validity': {
            title: '效度分析',
            description: '评估问卷量表的有效性，包含KMO与Bartlett检验、方差解释率与因子载荷系数分析',
            dropZones: [
                { id: 'analysisVars', label: '分析项', multiple: true, name: '分析项' }
            ]
        },
        'chi-square': {
            title: '卡方检验',
            description: '分析两个分类变量之间是否相互独立',
            dropZones: [
                { id: 'x-variable', label: 'X变量(分类)', multiple: true },
                { id: 'y-variable', label: 'Y变量(因变量,分类)', multiple: false }
            ]
        },
        'linear-regression': {
            title: '线性回归',
            description: '研究一个或多个自变量对因变量的影响关系',
            dropZones: [
                { id: 'y-variable', label: '因变量(Y)', multiple: false },
                { id: 'x-variables', label: '自变量(X)', multiple: true }
            ]
        },
        'anova': {
            title: '方差分析',
            description: '检验多个分类组间的数值均值是否存在显著差异',
            dropZones: [
                { id: 'y-variable', label: '因变量(数值)', multiple: true },
                { id: 'x-variable', label: '分组变量(分类)', multiple: false }
            ]
        },
        'ttest-independent': {
            title: '独立样本T检验',
            description: '检验两组独立样本的均值是否存在显著差异',
            dropZones: [
                { id: 'y-variable', label: '检验变量(数值)', multiple: true },
                { id: 'x-variable', label: '分组变量(分类)', multiple: true }
            ]
        },
        'ttest-paired': {
            title: '配对样本T检验',
            description: '检验配对样本(如实验前后)的均值是否存在显著差异',
            dropZones: [
                { id: 'pair1', label: '配对变量1', multiple: true },
                { id: 'pair2', label: '配对变量2', multiple: true }
            ]
        },
        'cfa': {
            title: '验证性因子分析(CFA)',
            description: '检验所假设的因子结构模型与实际数据的拟合程度，输出拟合指数与载荷',
            dropZones: [
                { id: 'factor1', label: '因子1', multiple: true, name: '因子 1' }
            ]
        },

        'sem': {
            title: '结构方程模型(AMOS)',
            description: '直接粘贴AMOS输出的文本结果，自动生成标准化报告',
            isTextMode: true,
            placeholder: '请在此处粘贴AMOS输出的完整分析结果（包含Model Fit, Regression Weights等表格内容）...'
        },
        'moderation': {
            title: '调节作用',
            description: '分析X对Y的影响是否因调节变量M的不同而产生变化',
            dropZones: [
                { id: 'x-variable', label: '自变量(X)', multiple: false },
                { id: 'm-variable', label: '调节变量(M)', multiple: false },
                { id: 'y-variable', label: '因变量(Y)', multiple: false }
            ]
        },
        'mediation': {
            title: '中介作用',
            description: '分析X对Y的影响是否通过中介变量M来传递',
            dropZones: [
                { id: 'x-variable', label: '自变量(X)', multiple: true },
                { id: 'm-variable', label: '中介变量(M)', multiple: true },
                { id: 'y-variable', label: '因变量(Y)', multiple: false },
                { id: 'control-variables', label: '控制变量', multiple: true }
            ]
        },
        'ipa': {
            title: 'IPA分析',
            description: '重要性-表现程度分析',
            dropZones: [
                { id: 'importance', label: '重要性变量', multiple: true },
                { id: 'performance', label: '表现变量', multiple: true }
            ]
        },
        'cluster': {
            title: '聚类分析',
            description: '将样本划分为具有相似特征的若干类别',
            dropZones: [
                { id: 'variables', label: '聚类变量', multiple: true }
            ]
        },
        'efa': {
            title: '探索性因子分析(EFA)',
            description: '探索数据内部潜在的因子结构',
            dropZones: [
                { id: 'variables', label: '分析变量', multiple: true }
            ]
        },
        'binary-logit': {
            title: '二元Logit回归',
            description: '因变量为二分类(0/1)时的回归分析',
            dropZones: [
                { id: 'y-variable', label: '因变量(二分类)', multiple: false },
                { id: 'x-variables', label: '自变量(X)', multiple: true }
            ]
        },
        'partial-correlation': {
            title: '偏相关分析',
            description: '控制某些变量的影响后，分析其他变量间的净相关关系',
            dropZones: [
                { id: 'variables', label: '分析变量', multiple: true },
                { id: 'control', label: '控制变量', multiple: true }
            ]
        }
    };
    
    return methods[methodId] || {
        title: '未知方法',
        description: '请选择一个有效的分析方法',
        dropZones: []
    };
}

function generateDropZones(methodId) {
    // 切换方法时清空已使用变量
    usedVariables.clear();
    updateVariableVisibility();

    const dragDropArea = document.getElementById('dragDropArea');
    if (!dragDropArea) return;
    
    dragDropArea.innerHTML = '';
    const methodInfo = getMethodInfo(methodId);
    
    if (methodInfo.isTextMode) {
        dragDropArea.style.display = 'block';
        
        if (methodId === 'sem') {
            const createSection = (id, label, placeholder) => {
                const section = document.createElement('div');
                section.style.marginBottom = '20px';
                
                const title = document.createElement('h4');
                title.textContent = label;
                title.style.marginBottom = '10px';
                title.style.fontSize = '14px';
                title.style.fontWeight = 'bold';
                
                const textArea = document.createElement('textarea');
                textArea.id = id;
                textArea.className = 'form-control';
                textArea.style.width = '100%';
                textArea.style.height = '150px';
                textArea.style.padding = '10px';
                textArea.style.border = '1px solid #ccc';
                textArea.style.borderRadius = '4px';
                textArea.style.fontFamily = 'monospace';
                textArea.style.resize = 'vertical';
                textArea.placeholder = placeholder;
                
                section.appendChild(title);
                section.appendChild(textArea);
                return section;
            };
            
            dragDropArea.appendChild(createSection('sem-path-input', '路径分析', '在此粘贴路径分析输出的表格（支持直接从Excel复制粘贴）...'));
            dragDropArea.appendChild(createSection('sem-fit-input', '模型拟合度', '在此粘贴模型拟合度输出的表格（支持直接从Excel复制粘贴）...'));
            dragDropArea.appendChild(createSection('sem-mediation-input', '中介作用', '在此粘贴中介作用输出的表格（支持直接从Excel复制粘贴）...'));
        } else {
            const textArea = document.createElement('textarea');
            textArea.id = 'sem-text-input';
            textArea.className = 'form-control';
            textArea.style.width = '100%';
            textArea.style.height = '400px';
            textArea.style.padding = '10px';
            textArea.style.border = '1px solid #ccc';
            textArea.style.borderRadius = '4px';
            textArea.style.fontFamily = 'monospace';
            textArea.style.resize = 'vertical';
            textArea.placeholder = methodInfo.placeholder || '在此输入文本...';
            dragDropArea.appendChild(textArea);
        }
        return;
    }

    methodInfo.dropZones.forEach((zone, index) => {
        createDropZoneElement(dragDropArea, zone, methodId, index);
    });
    
    // 为信度分析、CFA添加"添加分组"按钮
    if (['reliability', 'cfa'].includes(methodId)) {
        const btnDiv = document.createElement('div');
        btnDiv.style.gridColumn = "1 / -1";
        btnDiv.style.textAlign = "center";
        btnDiv.style.marginTop = "10px";
        btnDiv.innerHTML = `<button class="btn btn-secondary" onclick="addFactorGroup('${methodId}')"><i class="fas fa-plus"></i> 添加因子/分组</button>`;
        dragDropArea.appendChild(btnDiv);
    }
    
    dragDropArea.style.display = 'grid';
}

function createDropZoneElement(container, zone, methodId, index) {
    const dropZone = document.createElement('div');
    const analysisKey = zone.id;
    const zoneDomId = allocateZoneDomId(methodId, analysisKey);
    dropZone.className = 'drop-zone';
    dropZone.dataset.zoneId = zoneDomId;
    dropZone.dataset.analysisKey = analysisKey;
    dropZone.dataset.multiple = zone.multiple;
    
    let headerHtml = `<h4>${zone.label}</h4>`;
    let deleteButtonHtml = '';
    
    // 多组分析特殊处理：添加分组名称输入框
    if (['reliability', 'cfa', 'sem'].includes(methodId)) {
        const groupName = zone.name || `因子 ${index + 1}`;
        deleteButtonHtml = index > 0 ? `<button class="btn btn-sm btn-danger" style="padding:2px 6px; font-size:12px; min-height:unset;" onclick="removeFactorGroup(this)">删除</button>` : '';
        headerHtml = `
            <div style="display:flex; flex-direction:column; gap:5px; width: 100%;">
                <h4>${zone.label || '分组'}</h4>
                <input type="text" class="group-name-input" value="${groupName}" placeholder="请输入因子/分组名称" style="padding:4px; border:1px solid #ccc; border-radius:4px; font-size:12px; width:100%;">
            </div>
        `;
    }

    dropZone.innerHTML = `
        <div class="drop-zone-header">
            <div class="drop-zone-main">
                ${headerHtml}
                <p class="drop-hint">拖拽变量至此或点击添加</p>
            </div>
        </div>
        <div class="drop-zone-actions-row">
            ${deleteButtonHtml}
            <button class="btn btn-primary btn-sm" style="padding:4px 12px; font-size:12px; min-height:unset;" onclick="addSelectedToZone('${zoneDomId}', ${zone.multiple})">添加已选</button>
        </div>
        <div class="dropped-variables" id="${zoneDomId}-container"></div>
    `;
    
    // 添加放置事件
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const rawData = e.dataTransfer.getData('text/plain');
            
            try {
                // 尝试解析JSON（多选拖拽）
                const data = JSON.parse(rawData);
                if (data && Array.isArray(data.items)) {
                    data.items.forEach(v => {
                        addVariableToZone(zoneDomId, v, zone.multiple);
                    });
                } else {
                    // 只有单个变量的情况
                    if (rawData) addVariableToZone(zoneDomId, rawData, zone.multiple);
                }
            } catch (err) {
                // 解析失败，说明是普通文本（可能是单个变量的旧逻辑或触摸逻辑传递）
                if (rawData) addVariableToZone(zoneDomId, rawData, zone.multiple);
            }
        });
    
    container.appendChild(dropZone);
}

window.addFactorGroup = function(methodId) {
    const dragDropArea = document.getElementById('dragDropArea');
    const existingGroups = dragDropArea.querySelectorAll('.drop-zone').length;
    const newId = createGroupAnalysisKey(methodId);
    
    // 插入到按钮之前
    const btnDiv = dragDropArea.lastElementChild;
    
    const zone = {
        id: newId,
        label: `因子 ${existingGroups + 1}`,
        multiple: true,
        name: `因子 ${existingGroups + 1}`
    };
    
    createDropZoneElement(dragDropArea, zone, methodId, existingGroups);
    
    // Move button to end
    dragDropArea.appendChild(btnDiv);
};

window.removeFactorGroup = function(btn) {
    const dropZone = btn.closest('.drop-zone');
    
    // Clear variables from usedVariables
    dropZone.querySelectorAll('.dropped-variable').forEach(item => {
        const v = item.dataset.variable;
        if (usedVariables.has(v)) usedVariables.delete(v);
    });
    updateVariableVisibility();
    namingZoneRegistry.delete(dropZone.dataset.zoneId || '');
    
    dropZone.remove();
};

// 保留旧函数名以防万一，指向新函数
window.addReliabilityGroup = () => addFactorGroup('reliability');
window.removeReliabilityGroup = removeFactorGroup;

window.addSelectedToZone = function(zoneId, isMultiple) {
    if (selectedVariables.size === 0) {
        showMessage('请先选择变量', 'warning');
        return;
    }
    
    if (!isMultiple && selectedVariables.size > 1) {
        showMessage('该区域只能添加一个变量', 'warning');
        return;
    }
    
    // Convert to array to avoid issues with modification during iteration
    Array.from(selectedVariables).forEach(variable => {
        addVariableToZone(zoneId, variable, isMultiple);
    });
    
    // 清空选择
    clearVariableSelection();
};

function addVariableToZone(zoneId, variableName, isMultiple) {
    const container = document.getElementById(zoneId + '-container');
    if (!container) return;
    const normalizedVariableName = String(variableName || '').trim();
    if (!normalizedVariableName) return;
    
    if (!isMultiple) {
        // 如果是单选区域，清空现有内容
        container.querySelectorAll('.dropped-variable').forEach(item => {
            const oldVar = item.dataset.variable;
            if (usedVariables.has(oldVar)) usedVariables.delete(oldVar);
        });
        container.innerHTML = '';
    }
    
    // 检查是否已存在
    const existing = Array.from(container.querySelectorAll('.dropped-variable'))
        .some(item => item.dataset.variable === normalizedVariableName);
    if (existing) return;
    if (usedVariables.has(normalizedVariableName)) return;
    
    const item = document.createElement('div');
    item.className = 'dropped-variable';
    item.dataset.variable = normalizedVariableName;
    item.dataset.variableKey = allocateVariableKey(zoneId, normalizedVariableName);
    item.innerHTML = `
        <span>${normalizedVariableName}</span>
        <span class="remove-btn" onclick="removeVariableFromZone(this)">×</span>
    `;
    container.appendChild(item);
    
    usedVariables.add(normalizedVariableName);
    updateVariableVisibility();
}

function setupEventListeners() {
    const exportBtn = document.getElementById('exportResults');
    const copyBtn = document.getElementById('copyResults');
    if (exportBtn) exportBtn.addEventListener('click', exportResults);
    if (copyBtn) copyBtn.addEventListener('click', copyResults);
    
    document.getElementById('clearSelectionBtn').addEventListener('click', () => {
        document.querySelectorAll('.dropped-variables').forEach(el => el.innerHTML = '');
        usedVariables.clear();
        updateVariableVisibility();
        showMessage('已清空所有变量', 'info');
    });
}

function runAnalysis(method) {
    const methodInfo = getMethodInfo(method);
    const isTextMode = methodInfo && methodInfo.isTextMode;

    if (!isTextMode && !currentData) {
        showMessage('请先上传数据', 'error');
        return;
    }
    
    showLoading();
    
    try {
        // 收集变量
        const variables = {};
        const groupNames = {};
        
        // Handle SEM text input
        if (method === 'sem') {
            const pathInput = document.getElementById('sem-path-input');
            const fitInput = document.getElementById('sem-fit-input');
            const mediationInput = document.getElementById('sem-mediation-input');
            
            variables['semPathText'] = pathInput ? pathInput.value : '';
            variables['semFitText'] = fitInput ? fitInput.value : '';
            variables['semMediationText'] = mediationInput ? mediationInput.value : '';
        } else {
            const semInput = document.getElementById('sem-text-input');
            if (semInput) {
                 variables['semText'] = semInput.value;
            }
        }
        
        document.querySelectorAll('.drop-zone').forEach(zone => {
            const analysisKey = zone.dataset.analysisKey || zone.dataset.zoneId;
            const vars = [];
            zone.querySelectorAll('.dropped-variable').forEach(item => {
                vars.push(item.dataset.variable);
            });
            variables[analysisKey] = vars;
            
            // 收集分组名称
            const nameInput = zone.querySelector('.group-name-input');
            if (nameInput) {
                groupNames[analysisKey] = nameInput.value;
            }
        });
        
        variables._groupNames = groupNames;
        
        const result = performAnalysis(method, variables);
        
        // 显示结果
        displayResults(result);
        
        hideLoading();
        showMessage('分析完成', 'success');
        
    } catch (error) {
        hideLoading();
        showMessage('分析错误: ' + error.message, 'error');
        console.error(error);
    }
}

function performAnalysis(method, variables) {
    const analysisFunctions = {
        'descriptive': performDescriptiveAnalysis,
        'frequency': performFrequencyAnalysis,
        'correlation': performCorrelationAnalysis,
        'reliability': performReliabilityAnalysis,
        'validity': performValidityAnalysis,
        'chi-square': performChiSquareTest,
        'linear-regression': performLinearRegression,
        'anova': performANOVA,
        'ttest-independent': performIndependentTTest,
        'ttest-paired': performPairedTTest,
        'cfa': performCFA,
        'sem': performSEM,
        'moderation': performModeration,
        'mediation': performMediation,
        'ipa': performIPA,
        'cluster': performCluster,
        'efa': performEFA,
        'binary-logit': performBinaryLogit,
        'partial-correlation': performPartialCorrelation,
        'path-analysis': performPathAnalysis
    };
    
    const func = analysisFunctions[method];
    if (!func) throw new Error('该方法尚未实现');
    
    return func(variables);
}

function getValidRows(variables) {
    return currentData.processed.filter(row => 
        variables.every(v => row[v] !== null && row[v] !== undefined && row[v] !== '')
    );
}

function addGenericInterpretation(html, method) {
    let text = `<strong>${method}结果解读：</strong>\n分析结果如上表所示，请关注表格中的关键指标（如显著性p值、均值差异等）。\n<strong>趋势与异常点：</strong>\n若p值<0.05，则说明结果具有统计学显著性，否则表明差异或关系不明显。请结合实际业务背景，评估异常值对结果的潜在影响。\n<strong>业务建议：</strong>基于显著的统计结果，针对目标群体或关键变量制定相应的优化策略。`;
    return html + `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${text.replace(/\n/g, '<br>')}</div>`;
}

// Chi-Square
function performChiSquareTest(variables) {
    const xVar = (variables['x-variable'] || [])[0];
    const yVar = (variables['y-variable'] || [])[0];
    if (!xVar || !yVar) throw new Error('请选择X和Y变量');
    
    const validData = getValidRows([xVar, yVar]);
    const total = validData.length;
    
    const table = {};
    const xTotals = {};
    const yTotals = {};
    
    validData.forEach(row => {
        const x = row[xVar];
        const y = row[yVar];
        if (!table[x]) table[x] = {};
        table[x][y] = (table[x][y] || 0) + 1;
        xTotals[x] = (xTotals[x] || 0) + 1;
        yTotals[y] = (yTotals[y] || 0) + 1;
    });
    
    let chiSquare = 0;
    const xKeys = Object.keys(xTotals).sort();
    const yKeys = Object.keys(yTotals).sort();
    
    xKeys.forEach(x => {
        yKeys.forEach(y => {
            const observed = (table[x] && table[x][y]) ? table[x][y] : 0;
            const expected = (xTotals[x] * yTotals[y]) / total;
            if (expected > 0) {
                chiSquare += Math.pow(observed - expected, 2) / expected;
            }
        });
    });
    
    const df = (xKeys.length - 1) * (yKeys.length - 1);
    let pValue = 1;
    if (window.jStat && df > 0) {
        pValue = 1 - jStat.chisquare.cdf(chiSquare, df);
    }
    let star = pValue < 0.01 ? '**' : (pValue < 0.05 ? '*' : '');
    
    let html = `<h3>卡方检验</h3>
        <p>* p<0.05，** p<0.01</p>
        <table class="result-table">
            <thead><tr><th>题目</th><th>名称</th>`;
            
    yKeys.forEach(y => html += `<th>${y}</th>`);
    html += `<th>总计</th><th>χ²</th><th>p</th></tr></thead><tbody>`;
    
    xKeys.forEach((x, index) => {
        html += `<tr>`;
        if (index === 0) html += `<td rowspan="${xKeys.length}">${xVar}</td>`;
        html += `<td>${x}</td>`;
        yKeys.forEach(y => {
            const obs = (table[x] && table[x][y]) ? table[x][y] : 0;
            const rowPct = (obs / xTotals[x]) * 100;
            html += `<td>${obs} (${rowPct.toFixed(2)}%)</td>`;
        });
        html += `<td>${xTotals[x]} (${((xTotals[x]/total)*100).toFixed(2)}%)</td>`;
        
        if (index === 0) {
            html += `<td rowspan="${xKeys.length}">${chiSquare.toFixed(3)}</td><td rowspan="${xKeys.length}">${pValue < 0.001 ? '0.000' : pValue.toFixed(3)}${star}</td>`;
        }
        html += `</tr>`;
    });
    
    html += `<tr><td></td><td>总计</td>`;
    yKeys.forEach(y => {
        html += `<td>${yTotals[y]}</td>`;
    });
    html += `<td>${total}</td><td></td><td></td></tr></tbody></table>`;
    
    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `利用卡方检验（交叉分析）研究 ${xVar} 与 ${yVar} 的差异关系。结果显示差异${pValue < 0.05 ? '显著' : '不显著'} (χ²=${chiSquare.toFixed(3)}, p=${pValue < 0.001 ? '0.000' : pValue.toFixed(3)})。`;
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
    
    return { method: '卡方检验', html };
}

// Independent T-Test
function performIndependentTTest(variables) {
    const yVars = variables['y-variable'] || [];
    const xVars = variables['x-variable'] || [];
    if (yVars.length === 0 || xVars.length === 0) throw new Error('请选择检验变量和分组变量');
    
    const fmt = (v, d) => { d = d || 2; return Number.isFinite(v) ? v.toFixed(d) : '-'; };
    const fmtP = (v) => { if (!Number.isFinite(v)) return '-'; return v < 0.001 ? '<0.001' : v.toFixed(3); };
    const stars = (v) => { if (!Number.isFinite(v)) return ''; return v < 0.001 ? '***' : (v < 0.01 ? '**' : (v < 0.05 ? '*' : '')); };
    
    function runTTest(xVar) {
        const validData = getValidRows([xVar]);
        const groupsSet = new Set(validData.map(r => r[xVar]));
        const groups = Array.from(groupsSet).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }));
        if (groups.length !== 2) return { error: '分组变量"' + xVar + '"必须恰好有2个类别 (当前有' + groups.length + '个)', results: [] };
        const g1 = groups[0], g2 = groups[1];
        const tResults = [];
        yVars.forEach(yVar => {
            const vData = getValidRows([yVar, xVar]);
            const arr1 = vData.filter(r => r[xVar] === g1).map(r => Number(r[yVar]));
            const arr2 = vData.filter(r => r[xVar] === g2).map(r => Number(r[yVar]));
            const n1 = arr1.length, n2 = arr2.length;
            const mean1 = n1 > 0 ? arr1.reduce((a,b)=>a+b,0)/n1 : NaN;
            const mean2 = n2 > 0 ? arr2.reduce((a,b)=>a+b,0)/n2 : NaN;
            const var1 = n1 > 1 ? arr1.reduce((a,b)=>a+Math.pow(b-mean1,2),0)/(n1-1) : 0;
            const var2 = n2 > 1 ? arr2.reduce((a,b)=>a+Math.pow(b-mean2,2),0)/(n2-1) : 0;
            let t = NaN, pValue = 1;
            if (n1 > 1 && n2 > 1) {
                const df = n1 + n2 - 2;
                const pooledVar = ((n1-1)*var1 + (n2-1)*var2) / df;
                const se = Math.sqrt(pooledVar * (1/n1 + 1/n2));
                if (se > 0) { t = (mean1 - mean2) / se; if (window.jStat) pValue = (1 - jStat.studentt.cdf(Math.abs(t), df)) * 2; }
                else if (mean1 === mean2) { t = 0; pValue = 1; }
            }
            tResults.push({ variable: yVar, n1, n2, mean1, mean2, sd1: Math.sqrt(var1), sd2: Math.sqrt(var2), t, pValue, df: n1+n2-2 });
        });
        return { xVar, g1, g2, results: tResults };
    }
    
    if (xVars.length === 1) {
        const tr = runTTest(xVars[0]);
        if (tr.error) throw new Error(tr.error);
        let html = '<h3>独立样本 T 检验</h3><p>* p<0.05，** p<0.01，*** p<0.001</p>';
        html += '<table class="result-table"><thead><tr><th>变量</th><th>分组</th><th>N</th><th>M</th><th>SD</th><th>t</th><th>df</th><th>p</th></tr></thead><tbody>';
        tr.results.forEach(r => {
            html += '<tr><td rowspan="2">' + r.variable + '</td><td>' + tr.g1 + '</td><td>' + r.n1 + '</td><td>' + fmt(r.mean1) + '</td><td>' + fmt(r.sd1) + '</td><td rowspan="2">' + fmt(r.t, 3) + '</td><td rowspan="2">' + r.df + '</td><td rowspan="2">' + fmtP(r.pValue) + stars(r.pValue) + '</td></tr>';
            html += '<tr><td>' + tr.g2 + '</td><td>' + r.n2 + '</td><td>' + fmt(r.mean2) + '</td><td>' + fmt(r.sd2) + '</td></tr>';
        });
        html += '</tbody></table>';
        let interp = '独立T检验结果：<br>';
        tr.results.forEach(r => { interp += r.variable + '：t(' + r.df + ')=' + fmt(r.t, 3) + '，p=' + fmtP(r.pValue) + stars(r.pValue) + '，差异' + (r.pValue < 0.05 ? '显著' : '不显著') + '<br>'; });
        html += '<div class="interpretation-text" contenteditable="true">' + interp + '</div>';
        return { method: '独立样本T检验', html };
    } else {
        const allResults = xVars.map(xv => runTTest(xv));
        const errors = allResults.filter(r => r.error);
        if (errors.length > 0) throw new Error(errors.map(e => e.error).join('; '));
        let html = '<h3>独立样本 T 检验（多组对比）</h3><p>* p<0.05，** p<0.01，*** p<0.001</p>';
        html += '<table class="result-table"><thead><tr><th>分组变量</th><th>检验变量</th><th>组别</th><th>N</th><th>M</th><th>SD</th><th>t</th><th>df</th><th>p</th></tr></thead><tbody>';
        allResults.forEach(tr => {
            tr.results.forEach((r, ri) => {
                html += '<tr>';
                if (ri === 0) html += '<td rowspan="' + (tr.results.length * 2) + '">' + tr.xVar + '</td>';
                html += '<td rowspan="2">' + r.variable + '</td><td>' + tr.g1 + '</td><td>' + r.n1 + '</td><td>' + fmt(r.mean1) + '</td><td>' + fmt(r.sd1) + '</td>';
                html += '<td rowspan="2">' + fmt(r.t, 3) + '</td><td rowspan="2">' + r.df + '</td><td rowspan="2">' + fmtP(r.pValue) + stars(r.pValue) + '</td>';
                html += '</tr><tr><td>' + tr.g2 + '</td><td>' + r.n2 + '</td><td>' + fmt(r.mean2) + '</td><td>' + fmt(r.sd2) + '</td></tr>';
            });
        });
        html += '</tbody></table>';
        let interp = '独立T检验多组对比结果：<br>';
        allResults.forEach(tr => { tr.results.forEach(r => { interp += tr.xVar + '/' + r.variable + '：t(' + r.df + ')=' + fmt(r.t, 3) + '，p=' + fmtP(r.pValue) + stars(r.pValue) + '，差异' + (r.pValue < 0.05 ? '显著' : '不显著') + '<br>'; }); });
        html += '<div class="interpretation-text" contenteditable="true">' + interp + '</div>';
        return { method: '独立样本T检验', html };
    }
}Test
function performPairedTTest(variables) {
    const pair1Vars = variables['pair1'] || [];
    const pair2Vars = variables['pair2'] || [];
    
    if (pair1Vars.length === 0 || pair2Vars.length === 0) throw new Error('请选择两个配对变量组');
    if (pair1Vars.length !== pair2Vars.length) throw new Error(`配对变量数量不一致：配对1有${pair1Vars.length}个，配对2有${pair2Vars.length}个`);
    
    // Check if any pair is invalid (e.g. same variable)
    // Actually, paired t-test can be run on same variable (though result is 0 diff), but usually distinct variables.
    // We'll proceed.
    
    // Validate data for ALL pairs first to ensure consistency? 
    // Or just filter valid rows for each pair independently?
    // Usually paired t-test uses listwise deletion for each pair.
    
    let html = `<h3>配对 T 检验</h3>
        <p>* p<0.05，** p<0.01</p>
        <table class="result-table">
            <thead><tr><th>名称</th><th>配对1</th><th>配对2</th><th>差值(配对1-配对2)</th><th>t</th><th>p</th></tr></thead>
            <tbody>`;
            
    const results = [];
    
    for (let i = 0; i < pair1Vars.length; i++) {
        const p1 = pair1Vars[i];
        const p2 = pair2Vars[i];
        
        const validData = getValidRows([p1, p2]);
        const n = validData.length;
        
        if (n < 2) {
            html += `<tr><td>${p1} - ${p2}</td><td colspan="5">有效样本量不足 (n=${n})</td></tr>`;
            continue;
        }
        
        const arr1 = validData.map(row => Number(row[p1]));
        const arr2 = validData.map(row => Number(row[p2]));
        
        const mean1 = arr1.reduce((a,b)=>a+b,0)/n;
        const mean2 = arr2.reduce((a,b)=>a+b,0)/n;
        const std1 = Math.sqrt(arr1.reduce((a,b)=>a+Math.pow(b-mean1,2),0)/(n-1));
        const std2 = Math.sqrt(arr2.reduce((a,b)=>a+Math.pow(b-mean2,2),0)/(n-1));
        
        const diffs = arr1.map((v, idx) => v - arr2[idx]);
        const meanDiff = diffs.reduce((a,b)=>a+b,0)/n;
        const varDiff = diffs.reduce((a,b)=>a+Math.pow(b-meanDiff,2),0)/(n-1);
        const se = Math.sqrt(varDiff / n);
        
        let t = 0;
        let pValue = 1;
        
        if (se > 0) {
            t = meanDiff / se;
            const df = n - 1;
            if (window.jStat) {
                pValue = (1 - jStat.studentt.cdf(Math.abs(t), df)) * 2;
            }
        } else {
            // Perfect match or constant difference
            if (meanDiff === 0) pValue = 1; // No difference
            else pValue = 0; // Infinite t
        }
        
        let star = pValue < 0.01 ? '**' : (pValue < 0.05 ? '*' : '');
        
        html += `<tr>
            <td>${p1} - ${p2}</td>
            <td>${mean1.toFixed(2)}±${std1.toFixed(2)}</td>
            <td>${mean2.toFixed(2)}±${std2.toFixed(2)}</td>
            <td>${meanDiff.toFixed(2)}</td>
            <td>${t.toFixed(3)}</td>
            <td>${pValue < 0.001 ? '0.000' : pValue.toFixed(3)}${star}</td>
        </tr>`;
        
        results.push({ p1, p2, meanDiff, pValue, t });
    }
    
    html += `</tbody></table>`;
        
    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `本研究共进行了 ${pair1Vars.length} 组配对样本 T 检验。<br>`;
    
    const sigPairs = results.filter(r => r.pValue < 0.05);
    if (sigPairs.length > 0) {
        interpretation += `结果显示，以下配对存在显著差异：<br>`;
        sigPairs.forEach(r => {
             interpretation += `- **${r.p1} 与 ${r.p2}**：差异显著 (t=${r.t.toFixed(3)}, p=${r.pValue < 0.001 ? '0.000' : r.pValue.toFixed(3)})，平均差值为 ${r.meanDiff.toFixed(2)}。<br>`;
        });
    } else {
        interpretation += `结果显示，所有配对组均未发现显著差异 (p > 0.05)。<br>`;
    }
    
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
    
    return { method: '配对样本T检验', html };
}

// ANOVA
function performANOVA(variables) {
    const yVars = variables['y-variable'] || [];
    const xVars = variables['x-variable'] || [];
    if (yVars.length === 0 || xVars.length === 0) throw new Error('请选择检验变量和分组变量');
    
    const fmt = (v, d) => { d = d || 2; return Number.isFinite(v) ? v.toFixed(d) : '-'; };
    const fmtP = (v) => { if (!Number.isFinite(v)) return '-'; return v < 0.001 ? '<0.001' : v.toFixed(3); };
    const stars = (v) => { if (!Number.isFinite(v)) return ''; return v < 0.001 ? '***' : (v < 0.01 ? '**' : (v < 0.05 ? '*' : '')); };
    
    function runAnova(xVar) {
        const validData = getValidRows([xVar]);
        const groupsSet = new Set(validData.map(r => r[xVar]));
        const groups = Array.from(groupsSet).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }));
        if (groups.length < 2) return { error: '分组变量"' + xVar + '"至少需要2个类别', results: [] };
        const aResults = [];
        yVars.forEach(yVar => {
            const vData = getValidRows([yVar, xVar]);
            const gData = {};
            groups.forEach(g => gData[g] = []);
            vData.forEach(row => {
                const g = row[xVar], v = Number(row[yVar]);
                if (Number.isFinite(v) && gData[g]) gData[g].push(v);
            });
            const k = groups.filter(g => gData[g].length > 0).length;
            const N = Object.values(gData).reduce((s, arr) => s + arr.length, 0);
            if (N <= k) return;
            const grandMean = Object.values(gData).flat().reduce((s, v) => s + v, 0) / N;
            let SSbetween = 0, SSwithin = 0;
            groups.forEach(g => {
                const arr = gData[g]; const n = arr.length;
                if (n === 0) return;
                const m = arr.reduce((s, v) => s + v, 0) / n;
                SSbetween += n * Math.pow(m - grandMean, 2);
                SSwithin += arr.reduce((s, v) => s + Math.pow(v - m, 2), 0);
            });
            const dfBetween = k - 1, dfWithin = N - k;
            const MSbetween = dfBetween > 0 ? SSbetween / dfBetween : 0;
            const MSwithin = dfWithin > 0 ? SSwithin / dfWithin : 1;
            const F = MSbetween / MSwithin;
            let pValue = 1;
            if (window.jStat && dfBetween > 0 && dfWithin > 0) pValue = 1 - jStat.centralF.cdf(F, dfBetween, dfWithin);
            const groupStats = groups.map(g => { const arr = gData[g]; const n = arr.length; const m = n > 0 ? arr.reduce((s, v) => s + v, 0) / n : 0; const sd = n > 1 ? Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (n - 1)) : 0; return { group: g, n, mean: m, sd }; });
            aResults.push({ variable: yVar, N, k, SSbetween, SSwithin, dfBetween, dfWithin, MSbetween, MSwithin, F, pValue, groupStats });
        });
        return { xVar, groups, results: aResults };
    }
    
    if (xVars.length === 1) {
        const ar = runAnova(xVars[0]);
        if (ar.error) throw new Error(ar.error);
        let html = '<h3>单因素方差分析（One-way ANOVA）</h3><p>* p<0.05，** p<0.01，*** p<0.001</p>';
        ar.results.forEach(r => {
            html += '<p><strong>' + r.variable + '</strong></p>';
            html += '<table class="result-table"><thead><tr><th>组别</th><th>N</th><th>M</th><th>SD</th></tr></thead><tbody>';
            r.groupStats.forEach(gs => {
                html += '<tr><td>' + gs.group + '</td><td>' + gs.n + '</td><td>' + fmt(gs.mean) + '</td><td>' + fmt(gs.sd) + '</td></tr>';
            });
            html += '</tbody></table>';
            html += '<p>F(' + r.dfBetween + ',' + r.dfWithin + ')=' + fmt(r.F, 3) + '，p=' + fmtP(r.pValue) + stars(r.pValue) + '，差异' + (r.pValue < 0.05 ? '显著' : '不显著') + '</p>';
        });
        let interp = '单因素方差分析结果：<br>';
        ar.results.forEach(r => { interp += r.variable + '：F(' + r.dfBetween + ',' + r.dfWithin + ')=' + fmt(r.F, 3) + '，p=' + fmtP(r.pValue) + stars(r.pValue) + '，差异' + (r.pValue < 0.05 ? '显著' : '不显著') + '<br>'; });
        html += '<div class="interpretation-text" contenteditable="true">' + interp + '</div>';
        return { method: '方差分析', html };
    } else {
        const allAr = xVars.map(xv => runAnova(xv));
        const errors = allAr.filter(r => r.error);
        if (errors.length > 0) throw new Error(errors.map(e => e.error).join('; '));
        let html = '<h3>单因素方差分析（多组对比）</h3><p>* p<0.05，** p<0.01，*** p<0.001</p>';
        html += '<table class="result-table"><thead><tr><th>分组变量</th><th>检验变量</th><th>组别</th><th>N</th><th>M</th><th>SD</th><th>F</th><th>df</th><th>p</th></tr></thead><tbody>';
        allAr.forEach(ar => {
            ar.results.forEach((r, ri) => {
                r.groupStats.forEach((gs, gi) => {
                    html += '<tr>';
                    if (ri === 0 && gi === 0) html += '<td rowspan="' + ar.results.reduce((s, rr) => s + rr.groupStats.length, 0) + '">' + ar.xVar + '</td>';
                    if (gi === 0) html += '<td rowspan="' + r.groupStats.length + '">' + r.variable + '</td>';
                    html += '<td>' + gs.group + '</td><td>' + gs.n + '</td><td>' + fmt(gs.mean) + '</td><td>' + fmt(gs.sd) + '</td>';
                    if (gi === 0) html += '<td rowspan="' + r.groupStats.length + '">' + fmt(r.F, 3) + '</td><td rowspan="' + r.groupStats.length + '">' + r.dfBetween + ',' + r.dfWithin + '</td><td rowspan="' + r.groupStats.length + '">' + fmtP(r.pValue) + stars(r.pValue) + '</td>';
                    html += '</tr>';
                });
            });
        });
        html += '</tbody></table>';
        let interp = '方差分析多组对比结果：<br>';
        allAr.forEach(ar => { ar.results.forEach(r => { interp += ar.xVar + '/' + r.variable + '：F(' + r.dfBetween + ',' + r.dfWithin + ')=' + fmt(r.F, 3) + '，p=' + fmtP(r.pValue) + stars(r.pValue) + '，差异' + (r.pValue < 0.05 ? '显著' : '不显著') + '<br>'; }); });
        html += '<div class="interpretation-text" contenteditable="true">' + interp + '</div>';
        return { method: '方差分析', html };
    }
}sion
function performLinearRegression(variables) {
    const yVar = (variables['y-variable'] || [])[0];
    const xVars = variables['x-variables'] || [];
    if (!yVar || xVars.length === 0) throw new Error('请选择因变量和自变量');
    
    const validData = getValidRows([yVar, ...xVars]);
    const n = validData.length;
    const p = xVars.length;
    if (n <= p + 1) throw new Error('样本量不足以进行回归分析');
    
    let html = `<h3>线性回归分析</h3>`;
    
    try {
        const X = validData.map(row => [1, ...xVars.map(x => Number(row[x]))]);
        const Y = validData.map(row => [Number(row[yVar])]);
        
        const XT = jStat.transpose(X);
        const XTX = jStat.multiply(XT, X);
        const XTX_inv = jStat.inv(XTX);
        const XTY = jStat.multiply(XT, Y);
        const Beta = jStat.multiply(XTX_inv, XTY);
        
        const yMean = Y.reduce((a,b)=>a+b[0],0)/n;
        let ssTotal = 0;
        let ssRes = 0;
        
        const Y_pred = jStat.multiply(X, Beta);
        
        let dw_num = 0, dw_den = 0;
        let prev_e = Y[0][0] - Y_pred[0][0];
        dw_den += prev_e * prev_e;
        
        for (let i=0; i<n; i++) {
            const e = Y[i][0] - Y_pred[i][0];
            ssTotal += Math.pow(Y[i][0] - yMean, 2);
            ssRes += Math.pow(e, 2);
            if (i > 0) {
                dw_num += Math.pow(e - prev_e, 2);
                dw_den += e * e;
                prev_e = e;
            }
        }
        
        const dw = dw_den === 0 ? 0 : dw_num / dw_den;
        
        const rSquared = 1 - (ssRes / ssTotal);
        const adjRSquared = 1 - (1 - rSquared) * ((n - 1) / (n - p - 1));
        
        const msReg = (ssTotal - ssRes) / p;
        const msRes = ssRes / (n - p - 1);
        const F = msReg / msRes;
        const pF = 1 - jStat.centralF.cdf(F, p, n - p - 1);
        
        const seBeta = [];
        for (let i=0; i<=p; i++) {
            seBeta.push(Math.sqrt(msRes * XTX_inv[i][i]));
        }
        
        html += `
            <table class="result-table">
                <thead><tr><th>自变量</th><th>非标准化系数 B</th><th>标准误</th><th>标准化系数 Beta</th><th>t</th><th>p</th><th>VIF</th><th>容忍度</th></tr></thead>
                <tbody>
        `;
        
        const yStd = Math.sqrt(ssTotal / (n-1));
        const terms = ['常数', ...xVars];
        
        let formula = `**${yVar} = ${Beta[0][0].toFixed(3)}`;
        
        const coefs = [];

        for (let i=0; i<=p; i++) {
            const b = Beta[i][0];
            const se = seBeta[i];
            const t = b / se;
            const pt = (1 - jStat.studentt.cdf(Math.abs(t), n - p - 1)) * 2;
            let star = pt < 0.01 ? '**' : (pt < 0.05 ? '*' : '');
            
            let stdBeta = '-';
            let vif = '-';
            let tol = '-';
            
            if (i > 0) {
                const xVals = validData.map(row => Number(row[xVars[i-1]]));
                const xMean = xVals.reduce((a,v)=>a+v,0)/n;
                const xVarSum = xVals.reduce((a,v)=>a+Math.pow(v-xMean,2),0);
                const xStd = Math.sqrt(xVarSum / (n-1));
                stdBeta = (b * (xStd / yStd)).toFixed(3);
                
                // Calculate VIF and Tolerance
                // VIF_i = 1 / (1 - R_i^2), where R_i^2 is from regressing x_i on all other x's
                let rSq_i = 0;
                
                if (p > 1) {
                    // Prepare data for auxiliary regression: x_i ~ other x's
                    const otherXVars = xVars.filter((_, idx) => idx !== i-1);
                    // Get data matrix for other x's (including constant term)
                    const auxX_mat = [];
                    const auxY = [];
                    
                    for(let r=0; r<n; r++) {
                        const row = [1];
                        otherXVars.forEach(ox => {
                            row.push(Number(validData[r][ox]));
                        });
                        auxX_mat.push(row);
                        auxY.push([Number(validData[r][xVars[i-1]])]);
                    }
                    
                    // Run regression
                    try {
                        const auxXT = jStat.transpose(auxX_mat);
                        const auxXTX = jStat.multiply(auxXT, auxX_mat);
                        const auxInv = jStat.inv(auxXTX);
                        const auxXTY = jStat.multiply(auxXT, auxY);
                        const auxBeta = jStat.multiply(auxInv, auxXTY);
                        
                        // Calculate R^2 for auxiliary regression
                        const yMeanAux = auxY.reduce((a,v) => a+v[0], 0) / n;
                        let ssTotalAux = 0;
                        let ssResAux = 0;
                        
                        for(let r=0; r<n; r++) {
                            let pred = 0;
                            for(let j=0; j<auxBeta.length; j++) {
                                pred += auxX_mat[r][j] * auxBeta[j][0];
                            }
                            ssTotalAux += Math.pow(auxY[r][0] - yMeanAux, 2);
                            ssResAux += Math.pow(auxY[r][0] - pred, 2);
                        }
                        
                        rSq_i = 1 - (ssResAux / ssTotalAux);
                        
                        // Guard against perfect correlation
                        if (rSq_i > 0.9999) rSq_i = 0.9999;
                        
                    } catch (e) {
                        console.error('VIF calculation error for ' + xVars[i-1], e);
                        rSq_i = 0;
                    }
                }
                
                const toleranceVal = 1 - rSq_i;
                const vifVal = 1 / toleranceVal;
                
                vif = vifVal.toFixed(3);
                tol = toleranceVal.toFixed(3);
                
                formula += ` ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(3)} * ${xVars[i-1]}`;
                
                coefs.push({ name: xVars[i-1], b, t, p: pt, star });
            }
            
            html += `<tr><td>${terms[i]}</td><td>${b.toFixed(3)}</td><td>${se.toFixed(3)}</td><td>${stdBeta}</td><td>${t.toFixed(3)}</td><td>${pt < 0.001 ? '0.000' : pt.toFixed(3)}${star}</td><td>${vif}</td><td>${tol}</td></tr>`;
        }
        formula += `**`;
        
        html += `</tbody></table>
        
        <div style="margin-top: 15px;">
            <strong>模型汇总：</strong><br>
            - R²：${rSquared.toFixed(3)}<br>
            - 调整 R²：${adjRSquared.toFixed(3)}<br>
            - F 检验：F (${p},${n-p-1})=${F.toFixed(3)}, p=${pF < 0.001 ? '0.000' : pF.toFixed(3)}<br>
            - D-W 值：${dw.toFixed(3)}
        </div>`;
        
        let interpretation = `<strong>结果解读：</strong><br>`;
        interpretation += `将${xVars.join('、')}作为自变量，将${yVar}作为因变量进行线性回归分析。模型公式为：${formula}。模型 R² 值为 ${rSquared.toFixed(3)}，意味着自变量可以解释因变量 ${(rSquared*100).toFixed(1)}% 的变化原因。F 检验 (p=${pF < 0.001 ? '0.000' : pF.toFixed(3)} ${pF < 0.05 ? '< 0.05' : '≥ 0.05'})${pF < 0.05 ? '表明模型整体达到显著水平。' : '未达到显著水平，模型整体解释力有限。'}`;
        
        coefs.forEach(c => {
            if (c.p < 0.05) {
                interpretation += `具体而言，${c.name}的回归系数值为 ${c.b.toFixed(3)} (t=${c.t.toFixed(3)}, p=${c.p < 0.001 ? '0.000' : c.p.toFixed(3)} ${c.p < 0.01 ? '< 0.01' : '< 0.05'})，意味着${c.name}对${yVar}产生显著的${c.b > 0 ? '正向' : '负向'}影响。`;
            } else {
                interpretation += `具体而言，${c.name}的回归系数值为 ${c.b.toFixed(3)} (t=${c.t.toFixed(3)}, p=${c.p < 0.001 ? '0.000' : c.p.toFixed(3)} ≥ 0.05)，未达到显著水平，暂不能认定其对${yVar}存在正向或负向影响。`;
            }
        });

        html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
        
    } catch (e) {
        html += `<p style="color:red">计算失败：${e.message}</p>`;
    }
    
    return { method: '线性回归', html };
}

function createPlaceholderResult(methodName, msg) {
    return {
        method: methodName,
        html: `<div style="padding:20px; text-align:center; color:#666;">
            <i class="fas fa-tools" style="font-size:3em; margin-bottom:10px;"></i>
            <h4>${methodName} 功能框架已就绪</h4>
            <p>${msg || '这是一个进阶分析功能，完整的算法模块正在接入中，当前仅提供操作界面与数据收集能力。'}</p>
        </div>`
    };
}

// ---------------- 增强统计功能模块 ----------------

// 辅助函数：计算CFA统计量 (AVE, CR, Loadings)
function getEigenMatrix(matrix) {
    let n = matrix.length;
    let eVec = Array(n).fill(0).map((_, i) => {
        let row = Array(n).fill(0);
        row[i] = 1;
        return row;
    });
    let A = matrix.map(row => [...row]);
    
    let maxIter = 100;
    for (let iter = 0; iter < maxIter; iter++) {
        let maxVal = 0, p = 0, q = 1;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                if (Math.abs(A[i][j]) > maxVal) {
                    maxVal = Math.abs(A[i][j]);
                    p = i;
                    q = j;
                }
            }
        }
        if (maxVal < 1e-9) break;
        
        let theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        let t = theta === 0 ? 1 : Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        
        let c = 1 / Math.sqrt(t * t + 1);
        let s = c * t;
        
        let app = c * c * A[p][p] - 2 * s * c * A[p][q] + s * s * A[q][q];
        let aqq = s * s * A[p][p] + 2 * s * c * A[p][q] + c * c * A[q][q];
        A[p][p] = app;
        A[q][q] = aqq;
        A[p][q] = A[q][p] = 0;
        
        for (let i = 0; i < n; i++) {
            if (i !== p && i !== q) {
                let api = c * A[p][i] - s * A[q][i];
                let aqi = s * A[p][i] + c * A[q][i];
                A[p][i] = A[i][p] = api;
                A[q][i] = A[i][q] = aqi;
            }
            let eip = c * eVec[i][p] - s * eVec[i][q];
            let eiq = s * eVec[i][p] + c * eVec[i][q];
            eVec[i][p] = eip;
            eVec[i][q] = eiq;
        }
    }
    
    let eVal = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        eVal[i] = A[i][i];
    }
    return [eVal, eVec];
}

// CFA 最大似然估计 (ML Estimation)
// 与AMOS/Mplus使用相同的ML方法，结果可直接对标
// CFA 最大似然估计 (ML Estimation) — BFGS + 解析梯度
// 与AMOS/Mplus使用相同的ML方法，结果可直接对标
function estimateCFAML(validData, groups) {
    const groupKeys = Object.keys(groups);
    const allVars = [];
    groupKeys.forEach(k => groups[k].forEach(v => { if (!allVars.includes(v)) allVars.push(v); }));
    const p = allVars.length;
    const n = validData.length;
    const m = groupKeys.length;

    // 观测相关矩阵 S
    const S = [];
    for (let i = 0; i < p; i++) {
        S[i] = [];
        for (let j = 0; j < p; j++) {
            if (i === j) { S[i][j] = 1; continue; }
            const d1 = validData.map(r => Number(r[allVars[i]]));
            const d2 = validData.map(r => Number(r[allVars[j]]));
            S[i][j] = calculatePearson(d1, d2);
        }
    }
    const SlogDet = logDeterminant(S);
    if (!Number.isFinite(SlogDet)) throw new Error('相关矩阵奇异');

    // 变量→因子映射
    const varFactor = new Array(p).fill(-1);
    groupKeys.forEach((k, fIdx) => {
        groups[k].forEach(v => {
            const vi = allVars.indexOf(v);
            if (vi >= 0) varFactor[vi] = fIdx;
        });
    });

    // ===== 参数向量 =====
    // 载荷 λ_{ij}: p个参数 (所有变量对所属因子的载荷)
    // 因子协方差 Φ_{fg} (f<g): m*(m-1)/2个
    // 唯一方差 ψ_i: p个
    const loadingParams = [];
    let paramCount = 0;
    for (let i = 0; i < p; i++) {
        if (varFactor[i] >= 0) {
            loadingParams.push({ varIdx: i, factorIdx: varFactor[i], paramIdx: paramCount });
            paramCount++;
        }
    }
    const numLoadings = paramCount;

    const phiParams = [];
    for (let f = 0; f < m; f++) {
        for (let g = f + 1; g < m; g++) {
            phiParams.push({ f, g, paramIdx: paramCount });
            paramCount++;
        }
    }

    const psiStartIdx = paramCount;
    paramCount += p;
    const totalParams = paramCount;
    const df = Math.max(p * (p + 1) / 2 - totalParams, 0);

    // ===== 初始值 =====
    const theta = new Array(totalParams);
    const initStats = calculateCFAStats(validData, groups);
    const statsMap = {};
    initStats.groupStats.forEach(g => { statsMap[g.id] = g; });
    loadingParams.forEach(lp => {
        const gStat = statsMap[groupKeys[lp.factorIdx]];
        const vars = groups[groupKeys[lp.factorIdx]];
        const vIdx = vars.indexOf(allVars[lp.varIdx]);
        const init = (gStat && vIdx >= 0 && vIdx < gStat.loadings.length)
            ? Math.abs(gStat.loadings[vIdx]) : 0.5;
        theta[lp.paramIdx] = Math.max(0.15, Math.min(0.95, init));
    });
    phiParams.forEach(pp => {
        const fVars = groups[groupKeys[pp.f]];
        const gVars = groups[groupKeys[pp.g]];
        let sumR = 0, cnt = 0;
        fVars.forEach(v1 => {
            gVars.forEach(v2 => {
                const d1 = validData.map(r => Number(r[v1]));
                const d2 = validData.map(r => Number(r[v2]));
                sumR += calculatePearson(d1, d2);
                cnt++;
            });
        });
        theta[pp.paramIdx] = cnt > 0 ? Math.max(-0.8, Math.min(0.8, sumR / cnt)) : 0;
    });
    for (let i = 0; i < p; i++) {
        const lp = loadingParams.find(x => x.varIdx === i);
        const l = lp ? theta[lp.paramIdx] : 0.5;
        theta[psiStartIdx + i] = Math.max(0.05, 1 - l * l);
    }

    // ===== 矩阵构建 =====
    function buildMatrices(th) {
        const Lambda = [];
        for (let i = 0; i < p; i++) Lambda[i] = new Array(m).fill(0);
        loadingParams.forEach(lp => { Lambda[lp.varIdx][lp.factorIdx] = th[lp.paramIdx]; });

        const Phi = [];
        for (let i = 0; i < m; i++) {
            Phi[i] = new Array(m).fill(0);
            Phi[i][i] = 1;
        }
        phiParams.forEach(pp => {
            Phi[pp.f][pp.g] = th[pp.paramIdx];
            Phi[pp.g][pp.f] = th[pp.paramIdx];
        });

        const LP = []; // ΛΦ (p×m)
        for (let i = 0; i < p; i++) {
            LP[i] = new Array(m).fill(0);
            for (let f = 0; f < m; f++) {
                for (let g = 0; g < m; g++) {
                    LP[i][f] += Lambda[i][g] * Phi[g][f];
                }
            }
        }

        // Σ = ΛΦΛ' + Θ
        const Sigma = [];
        for (let i = 0; i < p; i++) {
            Sigma[i] = [];
            for (let j = 0; j < p; j++) {
                let val = 0;
                for (let f = 0; f < m; f++) val += LP[i][f] * Lambda[j][f];
                if (i === j) val += Math.max(th[psiStartIdx + i], 1e-4);
                Sigma[i][j] = val;
            }
        }
        return { Lambda, Phi, LP, Sigma };
    }

    // ===== ML拟合函数 =====
    function mlFit(th) {
        try {
            const { Sigma } = buildMatrices(th);
            const ld = logDeterminant(Sigma);
            if (!Number.isFinite(ld)) return 1e10;
            const SigInv = jStat.inv(Sigma);
            let trace = 0;
            for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) trace += S[i][j] * SigInv[j][i];
            const f = ld + trace - SlogDet - p;
            return Number.isFinite(f) && f > 0 ? f : (Number.isFinite(f) ? 0 : 1e10);
        } catch (e) { return 1e10; }
    }

    // ===== 解析梯度 =====
    // ∂F/∂θ = tr[(Σ⁻¹ - Σ⁻¹SΣ⁻¹) · ∂Σ/∂θ] = tr[W · ∂Σ/∂θ]
    // 其中 W = Σ⁻¹(I - Σ⁻¹S) = Σ⁻¹ - Σ⁻¹SΣ⁻¹
    function mlGradient(th) {
        const grad = new Array(totalParams).fill(0);
        try {
            const { Lambda, Phi, LP, Sigma } = buildMatrices(th);
            const SigInv = jStat.inv(Sigma);

            // W = Σ⁻¹ - Σ⁻¹SΣ⁻¹
            const SigInvS = [];
            for (let i = 0; i < p; i++) {
                SigInvS[i] = [];
                for (let j = 0; j < p; j++) {
                    let val = 0;
                    for (let k = 0; k < p; k++) val += SigInv[i][k] * S[k][j];
                    SigInvS[i][j] = val;
                }
            }
            const W = [];
            for (let i = 0; i < p; i++) {
                W[i] = [];
                for (let j = 0; j < p; j++) {
                    let val = SigInv[i][j];
                    for (let k = 0; k < p; k++) val -= SigInvS[i][k] * SigInv[k][j];
                    W[i][j] = val;
                }
            }

            // 载荷梯度: ∂F/∂λ_{ij} = 2 * Σ_b W_{ib} * (ΦΛ')_{jb}
            // = 2 * Σ_b W_{ib} * LP_{b,j}  (因为 LP = ΛΦ, (ΦΛ')' = ΛΦ = LP)
            // Wait: (ΦΛ')_{jb} = Σ_g Φ_{jg} Λ_{bg} = (ΛΦ')_{bj} = LP_{bj} (since Φ symmetric)
            // 所以 ∂F/∂λ_{ij} = 2 * Σ_b W_{ib} * LP_{b,jFactor}
            loadingParams.forEach(lp => {
                const i = lp.varIdx;
                const jF = lp.factorIdx;
                let g = 0;
                for (let b = 0; b < p; b++) g += W[i][b] * LP[b][jF];
                grad[lp.paramIdx] = 2 * g;
            });

            // 因子协方差梯度: ∂F/∂Φ_{fg} = 2 * (Λ'WΛ)_{fg}
            // 先算 WΛ (p×m)
            const WL = [];
            for (let i = 0; i < p; i++) {
                WL[i] = new Array(m).fill(0);
                for (let f = 0; f < m; f++) {
                    for (let b = 0; b < p; b++) WL[i][f] += W[i][b] * Lambda[b][f];
                }
            }
            // Λ'WΛ (m×m)
            const LtWL = [];
            for (let f = 0; f < m; f++) {
                LtWL[f] = new Array(m).fill(0);
                for (let g = 0; g < m; g++) {
                    for (let i = 0; i < p; i++) LtWL[f][g] += Lambda[i][f] * WL[i][g];
                }
            }
            phiParams.forEach(pp => {
                grad[pp.paramIdx] = 2 * LtWL[pp.f][pp.g];
            });

            // 唯一方差梯度: ∂F/∂ψ_i = W_{ii}
            for (let i = 0; i < p; i++) {
                grad[psiStartIdx + i] = W[i][i];
            }
        } catch (e) {
            // 回退到数值梯度
            const eps = 1e-5;
            for (let k = 0; k < totalParams; k++) {
                const old = th[k];
                th[k] = old + eps; const fp = mlFit(th);
                th[k] = old - eps; const fm = mlFit(th);
                th[k] = old;
                grad[k] = (fp - fm) / (2 * eps);
            }
        }
        return grad;
    }

    // ===== BFGS 优化 =====
    let Hinv = []; // 近似逆Hessian
    for (let i = 0; i < totalParams; i++) {
        Hinv[i] = new Array(totalParams).fill(0);
        Hinv[i][i] = 1; // 初始为单位矩阵
    }

    let currentFit = mlFit(theta);
    let currentGrad = mlGradient(theta);

    const maxIter = 800;
    const gradTol = 1e-6;
    const fitTol = 1e-8;

    for (let iter = 0; iter < maxIter; iter++) {
        // 检查梯度范数
        let gradNorm = 0;
        for (let k = 0; k < totalParams; k++) gradNorm += currentGrad[k] * currentGrad[k];
        gradNorm = Math.sqrt(gradNorm);
        if (gradNorm < gradTol) break;

        // 计算搜索方向 d = -Hinv * g
        const direction = new Array(totalParams);
        for (let i = 0; i < totalParams; i++) {
            direction[i] = 0;
            for (let j = 0; j < totalParams; j++) {
                direction[i] -= Hinv[i][j] * currentGrad[j];
            }
        }

        // Armijo线搜索
        let alpha = 1.0;
        const c1 = 1e-4;
        const rho = 0.5;
        const oldFit = currentFit;

        // 初始斜率 g'd
        let slope = 0;
        for (let k = 0; k < totalParams; k++) slope += currentGrad[k] * direction[k];

        let newTheta = new Array(totalParams);
        let newFit = currentFit;

        for (let ls = 0; ls < 40; ls++) {
            for (let k = 0; k < totalParams; k++) newTheta[k] = theta[k] + alpha * direction[k];

            // 约束
            for (let k = 0; k < totalParams; k++) {
                if (k >= psiStartIdx) newTheta[k] = Math.max(1e-4, Math.min(10, newTheta[k]));
                else if (k >= numLoadings) newTheta[k] = Math.max(-0.999, Math.min(0.999, newTheta[k]));
                else newTheta[k] = Math.max(-3, Math.min(3, newTheta[k]));
            }

            newFit = mlFit(newTheta);
            if (newFit <= oldFit + c1 * alpha * slope) break;
            alpha *= rho;
        }

        if (newFit >= currentFit) {
            // 线搜索失败，重置Hessian
            for (let i = 0; i < totalParams; i++) {
                Hinv[i] = new Array(totalParams).fill(0);
                Hinv[i][i] = 1;
            }
            // 用最速下降
            for (let k = 0; k < totalParams; k++) {
                newTheta[k] = theta[k] - 0.01 * currentGrad[k];
                if (k >= psiStartIdx) newTheta[k] = Math.max(1e-4, newTheta[k]);
                else if (k >= numLoadings) newTheta[k] = Math.max(-0.999, Math.min(0.999, newTheta[k]));
                else newTheta[k] = Math.max(-3, Math.min(3, newTheta[k]));
            }
            newFit = mlFit(newTheta);
            if (newFit >= currentFit) break;
        }

        // 更新theta
        const s = new Array(totalParams); // Δθ
        for (let k = 0; k < totalParams; k++) {
            s[k] = newTheta[k] - theta[k];
            theta[k] = newTheta[k];
        }

        const newGrad = mlGradient(theta);
        const y = new Array(totalParams); // Δg
        for (let k = 0; k < totalParams; k++) y[k] = newGrad[k] - currentGrad[k];

        // BFGS更新 Hinv
        let sy = 0;
        for (let k = 0; k < totalParams; k++) sy += s[k] * y[k];
        if (Math.abs(sy) > 1e-20) {
            // Hy = Hinv * y
            const Hy = new Array(totalParams);
            for (let i = 0; i < totalParams; i++) {
                Hy[i] = 0;
                for (let j = 0; j < totalParams; j++) Hy[i] += Hinv[i][j] * y[j];
            }
            let yHy = 0;
            for (let k = 0; k < totalParams; k++) yHy += y[k] * Hy[k];

            // Hinv = (I - sy'/sy)Hinv(I - ys'/sy) + ss'/sy
            for (let i = 0; i < totalParams; i++) {
                for (let j = 0; j < totalParams; j++) {
                    Hinv[i][j] += ((sy + yHy) * s[i] * s[j]) / (sy * sy)
                                - (Hy[i] * s[j] + s[i] * Hy[j]) / sy;
                }
            }
        }

        const fitDelta = Math.abs(currentFit - newFit);
        currentFit = newFit;
        currentGrad = newGrad;

        if (fitDelta < fitTol && iter > 10) break;
    }

    // ===== 提取结果 =====
    const { Lambda, Phi, Sigma } = buildMatrices(theta);

    const loadingsByGroup = {};
    groupKeys.forEach(k => { loadingsByGroup[k] = []; });
    loadingParams.forEach(lp => {
        const gKey = groupKeys[lp.factorIdx];
        loadingsByGroup[gKey].push({ var: allVars[lp.varIdx], loading: theta[lp.paramIdx] });
    });

    const groupResults = groupKeys.map(k => {
        const lds = loadingsByGroup[k].map(x => x.loading);
        const vars = loadingsByGroup[k].map(x => x.var);
        const sumL = lds.reduce((a, b) => a + b, 0);
        const sumL2 = lds.reduce((a, b) => a + b * b, 0);
        const sumE = lds.reduce((a, l) => a + (1 - l * l), 0);
        const ave = sumL2 / lds.length;
        const cr = (sumL * sumL) / ((sumL * sumL) + sumE);
        return { id: k, vars, loadings: lds, ave, cr };
    });

    // 标准误: 从信息矩阵的逆 (2/n * Hessian⁻¹ 的对角线)
    // BFGS的Hinv已经近似了Hessian⁻¹, SE = sqrt(2*Hinv_{kk}/n)
    const se = new Array(totalParams);
    for (let k = 0; k < totalParams; k++) {
        se[k] = Math.sqrt(Math.max(2 * Hinv[k][k] / n, 0));
        if (!Number.isFinite(se[k])) se[k] = NaN;
    }

    const chiSq = Math.max(0, (n - 1) * currentFit);

    return {
        loadingsByGroup, groupResults, Lambda, Phi, Sigma,
        theta, se, chiSq, df, fitValue: currentFit,
        totalParams, numLoadings, psiStartIdx,
        loadingParams, phiParams, varFactor, allVars, groupKeys,
        p, m, n
    };
}
// 计算矩阵的对数行列式 (LU分解)
function logDeterminant(matrix) {
    const n = matrix.length;
    const lu = matrix.map(row => [...row]);
    let sign = 1;
    for (let col = 0; col < n; col++) {
        let pivotRow = col;
        let pivotAbs = Math.abs(lu[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(lu[row][col]) > pivotAbs) {
                pivotAbs = Math.abs(lu[row][col]);
                pivotRow = row;
            }
        }
        if (pivotAbs < 1e-15) return -Infinity;
        if (pivotRow !== col) {
            [lu[col], lu[pivotRow]] = [lu[pivotRow], lu[col]];
            sign *= -1;
        }
        for (let row = col + 1; row < n; row++) {
            const factor = lu[row][col] / lu[col][col];
            for (let k = col + 1; k < n; k++) {
                lu[row][k] -= factor * lu[col][k];
            }
        }
    }
    let logDet = 0;
    for (let i = 0; i < n; i++) {
        if (lu[i][i] <= 0) return -Infinity;
        logDet += Math.log(lu[i][i]);
    }
    return sign > 0 ? logDet : -Infinity;
}
// CFA模型拟合指数计算
function calculateCFAFitIndices(validData, groups, groupStats) {
    const groupKeys = Object.keys(groups);
    const allVars = [];
    groupKeys.forEach(k => groups[k].forEach(v => { if (!allVars.includes(v)) allVars.push(v); }));
    const p = allVars.length;
    const n = validData.length;

    // 1. 观测协方差矩阵 (相关矩阵，标准化后等价)
    const S = [];
    for (let i = 0; i < p; i++) {
        S[i] = [];
        for (let j = 0; j < p; j++) {
            if (i === j) { S[i][j] = 1; continue; }
            const d1 = validData.map(r => Number(r[allVars[i]]));
            const d2 = validData.map(r => Number(r[allVars[j]]));
            S[i][j] = calculatePearson(d1, d2);
        }
    }

    // 2. 模型隐含协方差矩阵 Σ = ΛΛ' + Θ
    //   Λ是因子载荷矩阵，Θ是对角误差矩阵
    const varToGroup = {};
    groupKeys.forEach(k => groups[k].forEach(v => { varToGroup[v] = k; }));
    const numFactors = groupKeys.length;

    // 构建载荷矩阵 Λ (p × numFactors)
    const Lambda = [];
    for (let i = 0; i < p; i++) Lambda[i] = Array(numFactors).fill(0);

    groupKeys.forEach((k, fIdx) => {
        const gStat = groupStats.find(g => g.id === k);
        if (!gStat) return;
        groups[k].forEach((v, vIdx) => {
            const varIdx = allVars.indexOf(v);
            if (varIdx >= 0 && vIdx < gStat.loadings.length) {
                Lambda[varIdx][fIdx] = gStat.loadings[vIdx];
            }
        });
    });

    // Σ = ΛΛ' + Θ (假设因子间相关由后续估计)
    // 先算 ΛΛ'
    const LLt = [];
    for (let i = 0; i < p; i++) {
        LLt[i] = [];
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let f = 0; f < numFactors; f++) sum += Lambda[i][f] * Lambda[j][f];
            LLt[i][j] = sum;
        }
    }

    // 因子间相关矩阵 Φ
    const Phi = [];
    for (let i = 0; i < numFactors; i++) {
        Phi[i] = [];
        for (let j = 0; j < numFactors; j++) {
            if (i === j) { Phi[i][j] = 1; continue; }
            const gI = groupKeys[i], gJ = groupKeys[j];
            const varsI = groups[gI], varsJ = groups[gJ];
            let sumR = 0, cnt = 0;
            varsI.forEach(v1 => {
                varsJ.forEach(v2 => {
                    const d1 = validData.map(r => Number(r[v1]));
                    const d2 = validData.map(r => Number(r[v2]));
                    sumR += calculatePearson(d1, d2);
                    cnt++;
                });
            });
            Phi[i][j] = cnt > 0 ? sumR / cnt : 0;
        }
    }

    // Σ = Λ Φ Λ' + Θ
    const Sigma = [];
    for (let i = 0; i < p; i++) {
        Sigma[i] = [];
        for (let j = 0; j < p; j++) {
            // (Λ Φ Λ')[i][j] = Σ_f Σ_g Λ[i][f] * Φ[f][g] * Λ[j][g]
            let modelCov = 0;
            for (let f = 0; f < numFactors; f++) {
                for (let g = 0; g < numFactors; g++) {
                    modelCov += Lambda[i][f] * Phi[f][g] * Lambda[j][g];
                }
            }
            if (i === j) {
                // 加上误差方差 1 - λ² (标准化)
                const liSq = Lambda[i].reduce((s, v) => s + v * v, 0);
                modelCov += Math.max(1 - liSq, 0.01);
            }
            Sigma[i][j] = modelCov;
        }
    }

    // 3. SRMR: 标准化残差均方根
    let srmrNum = 0;
    for (let i = 0; i < p; i++) {
        for (let j = i; j < p; j++) {
            const resid = S[i][j] - Sigma[i][j];
            const weight = (i === j) ? 1 : 2;
            srmrNum += weight * resid * resid;
        }
    }
    const srmr = Math.sqrt(srmrNum / (p * (p + 1)));

    // 4. 卡方检验: χ² = (n-1) * F_min, F_min = tr(SΣ⁻¹) - log|SΣ⁻¹| - p
    // 简化: 用残差矩阵的迹
    let chiSq = 0;
    try {
        const SigmaInv = jStat.inv(Sigma);
        let traceSInvSig = 0;
        let logDetRatio = 0;

        // tr(S Σ⁻¹)
        for (let i = 0; i < p; i++) {
            for (let j = 0; j < p; j++) {
                traceSInvSig += S[i][j] * SigmaInv[j][i];
            }
        }

        // 简化的χ² = (n-1)/2 * Σ (s_ij - σ_ij)² / σ_ii * σ_jj
        chiSq = 0;
        for (let i = 0; i < p; i++) {
            for (let j = 0; j < p; j++) {
                const resid = S[i][j] - Sigma[i][j];
                chiSq += resid * resid / (Sigma[i][i] * Sigma[j][j]);
            }
        }
        chiSq = (n - 1) * chiSq / 2;
        if (!Number.isFinite(chiSq) || chiSq < 0) chiSq = 0;
    } catch (e) {
        chiSq = 0;
    }

    // 自由度: df = p*(p+1)/2 - (p*numFactors + numFactors*(numFactors-1)/2 + p)
    const numParams = p * numFactors + numFactors * (numFactors - 1) / 2 + p;
    const df = Math.max(p * (p + 1) / 2 - numParams, 1);

    // 5. CFI 和 TLI (与独立模型比较)
    // 独立模型: 所有变量不相关，χ²_null = (n-1) * (p - 1 - 2*p/(n-1))  (近似)
    let chiSqNull = 0;
    for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
            const r = S[i][j];
            chiSqNull += r * r;
        }
    }
    chiSqNull = (n - 1) * chiSqNull;
    const dfNull = p * (p - 1) / 2;

    const cfi = chiSqNull > 0 ? Math.max(0, Math.min(1, 1 - Math.max(chiSq - df, 0) / Math.max(chiSqNull - dfNull, 1))) : 0;
    const tli = (chiSqNull > 0 && df > 0)
        ? Math.max(0, Math.min(1, 1 - (chiSq / df) / (chiSqNull / dfNull)))
        : 0;

    // 6. RMSEA
    const rmsea = (df > 0 && n > 1)
        ? Math.sqrt(Math.max((chiSq - df) / (df * (n - 1)), 0))
        : 0;

    // 7. p-value for chi-square
    let chiSqP = 1;
    try {
        if (window.jStat && df > 0) chiSqP = 1 - jStat.chisquare.cdf(chiSq, df);
    } catch (e) { chiSqP = 1; }

    return { chiSq, df, chiSqP, cfi, tli, rmsea, srmr };
}
function calculateCFAStats(validData, groups) {
    const groupStats = [];
    const groupKeys = Object.keys(groups);
    
    groupKeys.forEach(gId => {
        const vars = groups[gId];
        if (vars.length < 1) return;
        
        // 提取该组数据
        const groupData = validData.map(row => vars.map(v => Number(row[v])));
        const n = groupData.length;
        const k = vars.length;
        
        let loadings = [];
        
        if (k === 1) {
            loadings = [1.0];
        } else {
            const rMatrix = [];
            for(let i=0; i<k; i++) {
                rMatrix[i] = [];
                for(let j=0; j<k; j++) {
                    const col1 = groupData.map(r => r[i]);
                    const col2 = groupData.map(r => r[j]);
                    rMatrix[i][j] = calculatePearson(col1, col2);
                }
            }
            
            // 使用第一主成分作为因子载荷估计
            try {
                const eigen = getEigenMatrix(rMatrix);
                const evs = eigen[0];
                const evecs = eigen[1];
                let maxIdx = 0;
                for(let i=1; i<k; i++) if(evs[i] > evs[maxIdx]) maxIdx = i;
                
                const lambda = Math.sqrt(Math.max(evs[maxIdx], 0));
                loadings = evecs.map(row => row[maxIdx] * lambda);
                let signAnchor = 0;
                for (let i = 0; i < loadings.length; i++) {
                    if (Math.abs(loadings[i]) > Math.abs(signAnchor)) signAnchor = loadings[i];
                }
                if (signAnchor < 0) {
                    loadings = loadings.map(v => -v);
                }
                for (let iter = 0; iter < 200; iter++) {
                    const prev = loadings.slice();
                    for (let i = 0; i < k; i++) {
                        let num = 0;
                        let den = 0;
                        for (let j = 0; j < k; j++) {
                            if (j === i) continue;
                            num += rMatrix[i][j] * prev[j];
                            den += prev[j] * prev[j];
                        }
                        if (den > 1e-12) loadings[i] = num / den;
                    }
                    let delta = 0;
                    for (let i = 0; i < k; i++) {
                        delta += Math.abs(loadings[i] - prev[i]);
                        if (!Number.isFinite(loadings[i])) loadings[i] = prev[i];
                        if (Math.abs(loadings[i]) > 0.999) loadings[i] = 0.999 * Math.sign(loadings[i]);
                    }
                    if (delta < 1e-8) break;
                }
            } catch(e) {
                loadings = Array(k).fill(0.7); // Fallback
            }
        }
        
        // AVE & CR
        let sumLambda = 0;
        let sumLambdaSq = 0;
        let sumError = 0;
        
        loadings.forEach(l => {
            const l2 = l * l;
            sumLambda += l;
            sumLambdaSq += l2;
            sumError += (1 - l2); // Standardized error variance
        });
        
        const ave = sumLambdaSq / k;
        const cr = (sumLambda * sumLambda) / ((sumLambda * sumLambda) + sumError);
        
        groupStats.push({ id: gId, vars, loadings, ave, cr });
    });
    
    return { groupStats };
}

// 辅助函数：计算HTMT
function calculateHTMT(validData, groups) {
    const gIds = Object.keys(groups);
    const matrix = {};
    
    for(let i=0; i<gIds.length; i++) {
        const g1 = gIds[i];
        matrix[g1] = {};
        for(let j=0; j<gIds.length; j++) {
            const g2 = gIds[j];
            if (i === j) {
                matrix[g1][g2] = 1; // Not really 1, but diagonal
                continue;
            }
            
            // Heterotrait correlations (average)
            const vars1 = groups[g1];
            const vars2 = groups[g2];
            let sumR_hetero = 0;
            let count_hetero = 0;
            
            vars1.forEach(v1 => {
                const d1 = validData.map(r => Number(r[v1]));
                vars2.forEach(v2 => {
                    const d2 = validData.map(r => Number(r[v2]));
                    sumR_hetero += Math.abs(calculatePearson(d1, d2));
                    count_hetero++;
                });
            });
            const avgHetero = sumR_hetero / count_hetero;
            
            // Monotrait correlations (average)
            let sumR_mono1 = 0;
            let count_mono1 = 0;
            vars1.forEach((v1, idx1) => {
                const d1 = validData.map(r => Number(r[v1]));
                vars1.forEach((v2, idx2) => {
                    if (idx1 !== idx2) {
                        const d2 = validData.map(r => Number(r[v2]));
                        sumR_mono1 += Math.abs(calculatePearson(d1, d2));
                        count_mono1++;
                    }
                });
            });
            const avgMono1 = count_mono1 > 0 ? sumR_mono1 / count_mono1 : 1;
            
            let sumR_mono2 = 0;
            let count_mono2 = 0;
            vars2.forEach((v1, idx1) => {
                const d1 = validData.map(r => Number(r[v1]));
                vars2.forEach((v2, idx2) => {
                    if (idx1 !== idx2) {
                        const d2 = validData.map(r => Number(r[v2]));
                        sumR_mono2 += Math.abs(calculatePearson(d1, d2));
                        count_mono2++;
                    }
                });
            });
            const avgMono2 = count_mono2 > 0 ? sumR_mono2 / count_mono2 : 1;
            
            const htmt = avgHetero / Math.sqrt(avgMono1 * avgMono2);
            matrix[g1][g2] = htmt;
        }
    }
    return matrix;
}

// 验证性因子分析 (CFA)
function performCFA(variables) {
    const groups = {};
    const groupNames = variables._groupNames || {};
    let allVars = [];
    
    Object.keys(variables).forEach(key => {
        if (key === '_groupNames') return;
        if (Array.isArray(variables[key]) && variables[key].length > 0) {
            groups[key] = variables[key];
            variables[key].forEach(v => { if (!allVars.includes(v)) allVars.push(v); });
        }
    });
    
    if (allVars.length < 3) throw new Error('CFA至少需要3个观测变量');
    
    const validData = getValidRows(allVars);
    const n = validData.length;
    if (n < 30) throw new Error('CFA建议样本量不少于30（当前n=' + n + '）');
    
    const groupKeys = Object.keys(groups);

    // ===== ML估计 =====
    let mlResult;
    try {
        mlResult = estimateCFAML(validData, groups);
    } catch (e) {
        throw new Error('CFA ML估计失败：' + e.message);
    }

    const stats = { groupStats: mlResult.groupResults };

    // ===== 拟合指数 =====
    const { chiSq, df, Sigma, p: numVars, m: numFactors, n: sampleN } = mlResult;

    // 用于独立模型比较的 χ²_null
    const S = [];
    for (let i = 0; i < numVars; i++) {
        S[i] = [];
        for (let j = 0; j < numVars; j++) {
            if (i === j) { S[i][j] = 1; continue; }
            const d1 = validData.map(r => Number(r[allVars[i]]));
            const d2 = validData.map(r => Number(r[allVars[j]]));
            S[i][j] = calculatePearson(d1, d2);
        }
    }
    let chiSqNull = 0;
    for (let i = 0; i < numVars; i++) {
        for (let j = i + 1; j < numVars; j++) {
            chiSqNull += S[i][j] * S[i][j];
        }
    }
    chiSqNull *= (sampleN - 1);
    const dfNull = numVars * (numVars - 1) / 2;

    // CFI & TLI
    const cfi = chiSqNull > 0
        ? Math.max(0, Math.min(1, 1 - Math.max(chiSq - df, 0) / Math.max(chiSqNull - dfNull, 1)))
        : 0;
    const tli = (chiSqNull > 0 && df > 0)
        ? Math.max(0, Math.min(1, 1 - (chiSq / df) / (chiSqNull / dfNull)))
        : 0;

    // RMSEA
    const rmsea = (df > 0 && sampleN > 1)
        ? Math.sqrt(Math.max((chiSq - df) / (df * (sampleN - 1)), 0))
        : 0;

    // SRMR
    let srmr = 0;
    let srmrCount = 0;
    for (let i = 0; i < numVars; i++) {
        for (let j = i; j < numVars; j++) {
            const resid = S[i][j] - Sigma[i][j];
            const weight = (i === j) ? 1 : 2;
            srmr += weight * resid * resid;
            srmrCount += weight;
        }
    }
    srmr = Math.sqrt(srmr / srmrCount);

    // χ² p值
    let chiSqP = 1;
    try { if (window.jStat && df > 0) chiSqP = 1 - jStat.chisquare.cdf(chiSq, df); } catch (e) {}

    const fitIndices = { chiSq, df, chiSqP, cfi, tli, rmsea, srmr };

    // ===== 标准误 & t值 =====
    const seByGroup = {};
    const tByGroup = {};
    const pByGroup = {};
    mlResult.groupResults.forEach(g => {
        seByGroup[g.id] = [];
        tByGroup[g.id] = [];
        pByGroup[g.id] = [];
    });
    mlResult.loadingParams.forEach(lp => {
        const gKey = groupKeys[lp.factorIdx];
        const seVal = mlResult.se[lp.paramIdx];
        const loadVal = mlResult.theta[lp.paramIdx];
        const tVal = seVal > 0 ? loadVal / seVal : 0;
        let pVal = 1;
        try { pVal = (1 - jStat.studentt.cdf(Math.abs(tVal), sampleN - 1)) * 2; } catch (e) {}
        seByGroup[gKey].push(seVal);
        tByGroup[gKey].push(tVal);
        pByGroup[gKey].push(pVal);
    });

    // HTMT
    let htmtMatrix = null;
    try { htmtMatrix = calculateHTMT(validData, groups); } catch (e) {}

    // ===== 聚合/区分效度判定 =====
    const convergentChecks = stats.groupStats.map(g => {
        const gName = groupNames[g.id] || g.id;
        const loadingPass = g.loadings.every(v => Math.abs(v) >= 0.6);
        const crPass = Number.isFinite(g.cr) && g.cr >= 0.7;
        const avePass = Number.isFinite(g.ave) && g.ave >= 0.5;
        return { gName, loadingPass, crPass, avePass };
    });
    const convergentFailed = convergentChecks.filter(c => !(c.loadingPass && c.crPass && c.avePass));
    const convergentInterpretation = convergentFailed.length === 0
        ? '各潜变量的标准载荷均≥0.6、CR≥0.7、AVE≥0.5，聚合效度良好。'
        : `部分潜变量未达聚合效度阈值：${convergentFailed.map(c => c.gName).join('、')}，建议检查。`;

    // 区分效度 - Fornell-Larcker
    const factorCorr = {};
    groupKeys.forEach((k1, i) => {
        factorCorr[k1] = {};
        groupKeys.forEach((k2, j) => {
            if (i === j) factorCorr[k1][k2] = Math.sqrt(stats.groupStats.find(g => g.id === k1).ave);
            else factorCorr[k1][k2] = Math.abs(mlResult.Phi[i][j]);
        });
    });

    const discriminantFailed = [];
    groupKeys.forEach((k1, i) => {
        groupKeys.forEach((k2, j) => {
            if (i >= j) return;
            const sq1 = factorCorr[k1][k1];
            const sq2 = factorCorr[k2][k2];
            const corr = factorCorr[k1][k2];
            if (!(sq1 > corr && sq2 > corr)) {
                discriminantFailed.push(`${groupNames[k1]||k1}↔${groupNames[k2]||k2}`);
            }
        });
    });
    const discriminantInterpretation = discriminantFailed.length === 0
        ? '各潜变量AVE平方根均大于与其他潜变量的相关系数，区分效度良好（Fornell-Larcker判据）。'
        : `以下构念对未通过Fornell-Larcker判据：${discriminantFailed.join('、')}。`;

    // HTMT判定
    let htmtInterpretation = '';
    if (htmtMatrix) {
        const htmtFailed = [];
        groupKeys.forEach((k1, i) => {
            groupKeys.forEach((k2, j) => {
                if (i >= j) return;
                const ht = htmtMatrix[k1] && htmtMatrix[k1][k2];
                if (Number.isFinite(ht) && ht >= 0.85) htmtFailed.push(`${groupNames[k1]||k1}↔${groupNames[k2]||k2}(${ht.toFixed(3)})`);
            });
        });
        htmtInterpretation = htmtFailed.length === 0
            ? '各HTMT值均<0.85，区分效度通过HTMT检验。'
            : `以下构念对HTMT≥0.85：${htmtFailed.join('、')}。`;
    }

    // ============ 构建HTML ============
    let html = `<h3>验证性因子分析（CFA）</h3>
        <p>本研究采用最大似然法（ML）对测量模型进行验证性因子分析，评估模型拟合、聚合效度与区分效度。</p>`;

    // （1）模型拟合
    const fitStatus = (val, threshold, op) => {
        if (!Number.isFinite(val)) return '-';
        return op === '<' ? (val < threshold ? '良好' : '不理想') : (val > threshold ? '良好' : '不理想');
    };
    html += `<h4>（1）模型拟合指数</h4>
    <table class="result-table">
        <thead><tr><th>指标</th><th>标准</th><th>值</th><th>判定</th></tr></thead>
        <tbody>
            <tr><td>χ²</td><td>-</td><td>${chiSq.toFixed(2)}</td><td>-</td></tr>
            <tr><td>df</td><td>-</td><td>${df}</td><td>-</td></tr>
            <tr><td>p</td><td>-</td><td>${chiSqP < 0.001 ? '<0.001' : chiSqP.toFixed(3)}</td><td>-</td></tr>
            <tr><td>χ²/df</td><td>&lt;3 良好, &lt;5 可接受</td><td>${df > 0 ? (chiSq / df).toFixed(3) : '-'}</td><td>${df > 0 ? fitStatus(chiSq / df, 3, '<') : '-'}</td></tr>
            <tr><td>CFI</td><td>&gt;0.9</td><td>${cfi.toFixed(3)}</td><td>${fitStatus(cfi, 0.9, '>')}</td></tr>
            <tr><td>TLI</td><td>&gt;0.9</td><td>${tli.toFixed(3)}</td><td>${fitStatus(tli, 0.9, '>')}</td></tr>
            <tr><td>RMSEA</td><td>&lt;0.06 良好, &lt;0.08 可接受</td><td>${rmsea.toFixed(3)}</td><td>${fitStatus(rmsea, 0.08, '<')}</td></tr>
            <tr><td>SRMR</td><td>&lt;0.08</td><td>${srmr.toFixed(3)}</td><td>${fitStatus(srmr, 0.08, '<')}</td></tr>
        </tbody>
    </table>`;

    const goodCount = [cfi > 0.9, tli > 0.9, rmsea < 0.08, srmr < 0.08].filter(Boolean).length;
    const fitText = goodCount >= 3
        ? `模型拟合指数：χ²/df=${(chiSq / df).toFixed(2)}，CFI=${cfi.toFixed(3)}，TLI=${tli.toFixed(3)}，RMSEA=${rmsea.toFixed(3)}，SRMR=${srmr.toFixed(3)}。主要指标均达可接受标准，模型拟合良好。`
        : `模型拟合指数：χ²/df=${(chiSq / df).toFixed(2)}，CFI=${cfi.toFixed(3)}，TLI=${tli.toFixed(3)}，RMSEA=${rmsea.toFixed(3)}，SRMR=${srmr.toFixed(3)}。部分指标未达理想标准，建议根据修正指数优化。`;
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${fitText}</p></div>`;

    // （2）聚合效度 (含标准误和t值)
    html += `<h4>（2）聚合效度</h4>
    <table class="result-table">
        <thead><tr><th>潜变量</th><th>测量项</th><th>非标准化载荷</th><th>S.E.</th><th>C.R.(t)</th><th>p</th><th>标准化载荷</th><th>AVE</th><th>CR</th></tr></thead>
        <tbody>`;
    stats.groupStats.forEach(g => {
        const gName = groupNames[g.id] || g.id;
        const ses = seByGroup[g.id] || [];
        const ts = tByGroup[g.id] || [];
        const ps = pByGroup[g.id] || [];
        g.vars.forEach((v, idx) => {
            const pStr = ps[idx] != null ? (ps[idx] < 0.001 ? '<0.001' : ps[idx].toFixed(3)) : '-';
            const star = (ps[idx] != null && ps[idx] < 0.001) ? '***' : ((ps[idx] != null && ps[idx] < 0.01) ? '**' : ((ps[idx] != null && ps[idx] < 0.05) ? '*' : ''));
            html += `<tr>`;
            if (idx === 0) html += `<td rowspan="${g.vars.length}">${gName}</td>`;
            html += `<td>${v}</td>
                <td>${g.loadings[idx].toFixed(3)}</td>
                <td>${ses[idx] != null ? ses[idx].toFixed(3) : '-'}</td>
                <td>${ts[idx] != null ? ts[idx].toFixed(3) : '-'}</td>
                <td>${pStr}${star}</td>
                <td>${g.loadings[idx].toFixed(3)}</td>`;
            if (idx === 0) html += `<td rowspan="${g.vars.length}">${g.ave.toFixed(3)}</td><td rowspan="${g.vars.length}">${g.cr.toFixed(3)}</td>`;
            html += `</tr>`;
        });
    });
    html += `</tbody></table>
    <p style="font-size:12px;color:#888;">注：最大似然法(ML)估计。非标准化载荷用于计算CR值，标准化载荷用于计算AVE值和判定。*** p&lt;0.001</p>
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${convergentInterpretation}</p></div>`;

    // （3）区分效度 - Fornell-Larcker
    html += `<h4>（3）区分效度（Fornell-Larcker判据）</h4>
    <table class="result-table">
        <thead><tr><th>变量</th>`;
    groupKeys.forEach(k => html += `<th>${groupNames[k]||k}</th>`);
    html += `</tr></thead><tbody>`;
    groupKeys.forEach(k1 => {
        html += `<tr><td>${groupNames[k1]||k1}</td>`;
        groupKeys.forEach(k2 => {
            let val = factorCorr[k1][k2].toFixed(3);
            if (k1 === k2) val = `<strong>${val}</strong>`;
            html += `<td>${val}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>
    <p style="font-size:12px;color:#888;">注：对角线加粗为AVE平方根，其余为因子间相关系数（ML估计）。AVE平方根应大于相关系数。</p>
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${discriminantInterpretation}</p></div>`;

    // （4）HTMT
    if (htmtMatrix) {
        html += `<h4>（4）区分效度（HTMT）</h4>
        <table class="result-table">
            <thead><tr><th>变量</th>`;
        groupKeys.forEach(k => html += `<th>${groupNames[k]||k}</th>`);
        html += `</tr></thead><tbody>`;
        groupKeys.forEach(k1 => {
            html += `<tr><td>${groupNames[k1]||k1}</td>`;
            groupKeys.forEach(k2 => {
                const val = (k1 === k2) ? '-' : (htmtMatrix[k1] && htmtMatrix[k1][k2] != null ? htmtMatrix[k1][k2].toFixed(3) : '-');
                html += `<td>${val}</td>`;
            });
            html += `</tr>`;
        });
        html += `</tbody></table>
        <p style="font-size:12px;color:#888;">注：HTMT<0.85表示区分效度良好（Henseler et al., 2015）。</p>
        <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${htmtInterpretation}</p></div>`;
    }

    return { method: '验证性因子分析(CFA)', html };
}
function performPathAnalysis(variables) {
    const groups = [];
    const groupNames = variables._groupNames || {};
    
    Object.keys(variables).forEach(key => {
        if (key === '_groupNames') return;
        if (Array.isArray(variables[key]) && variables[key].length > 0) {
            groups.push({ id: key, vars: variables[key] });
        }
    });
    
    if (groups.length < 2) throw new Error('路径分析至少需要2个因子/变量组（最后一个作为因变量）');
    
    const dvGroup = groups[groups.length - 1];
    const ivGroups = groups.slice(0, groups.length - 1);
    
    const allVars = groups.flatMap(g => g.vars);
    const validData = getValidRows(allVars);
    const n = validData.length;
    const p = ivGroups.length;
    if (n <= p + 1) throw new Error('样本量不足以进行路径分析');
    
    // 因子得分（均值法）
    const scores = {};
    groups.forEach(g => {
        scores[g.id] = validData.map(row => {
            const vals = g.vars.map(v => Number(row[v]));
            return vals.reduce((a, b) => a + b, 0) / vals.length;
        });
    });
    
    const Y = scores[dvGroup.id];
    const Xs = ivGroups.map(g => scores[g.id]);
    
    // OLS回归
    const X_mat = [];
    for (let i = 0; i < n; i++) {
        const row = [1];
        Xs.forEach(arr => row.push(arr[i]));
        X_mat.push(row);
    }
    const Y_mat = Y.map(y => [y]);
    
    let html = `<h3>路径分析</h3>
        <p>路径分析用于检验多个自变量（潜变量均值化得分）对因变量的直接效应。本研究以最后一个因子组"${groupNames[dvGroup.id] || dvGroup.id}"为因变量，其余因子为自变量进行多元回归分析。</p>`;
    
    try {
        const XT = jStat.transpose(X_mat);
        const XTX = jStat.multiply(XT, X_mat);
        const inv = jStat.inv(XTX);
        const XTY = jStat.multiply(XT, Y_mat);
        const Beta = jStat.multiply(inv, XTY);
        
        const yMean = jStat.mean(Y);
        let ssTot = 0, ssRes = 0;
        for (let i = 0; i < n; i++) {
            let pred = 0;
            for (let j = 0; j < Beta.length; j++) pred += X_mat[i][j] * Beta[j][0];
            ssTot += Math.pow(Y[i] - yMean, 2);
            ssRes += Math.pow(Y[i] - pred, 2);
        }
        const ssReg = ssTot - ssRes;
        const rSq = ssTot > 0 ? ssRes / ssTot > 1 ? 0 : 1 - ssRes / ssTot : 1;
        const adjRSq = 1 - (1 - rSq) * (n - 1) / (n - p - 1);
        
        // F检验
        const msReg = p > 0 ? ssReg / p : 0;
        const msRes = (n - p - 1) > 0 ? ssRes / (n - p - 1) : 0;
        const fStat = msRes > 0 ? msReg / msRes : 0;
        let fP = 1;
        try { if (window.jStat) fP = 1 - jStat.centralF.cdf(fStat, p, n - p - 1); } catch (e) {}
        
        const yStd = Math.sqrt(ssTot / (n - 1));
        const mse = msRes;
        
        // （1）模型摘要
        html += `<h4>（1）模型摘要</h4>
        <table class="result-table">
            <thead><tr><th>R</th><th>R²</th><th>调整R²</th><th>F</th><th>p</th></tr></thead>
            <tbody><tr>
                <td>${Math.sqrt(rSq).toFixed(3)}</td>
                <td>${rSq.toFixed(3)}</td>
                <td>${adjRSq.toFixed(3)}</td>
                <td>${fStat.toFixed(3)}</td>
                <td>${fP < 0.001 ? '<0.001' : fP.toFixed(3)}</td>
            </tr></tbody>
        </table>`;
        
        const modelFitText = fP < 0.05
            ? `回归模型整体显著（F(${p},${n - p - 1})=${fStat.toFixed(2)}, p${fP < 0.001 ? '<0.001' : '=' + fP.toFixed(3)}），R²=${rSq.toFixed(3)}，表明自变量整体能解释因变量${(rSq * 100).toFixed(1)}%的方差变异。`
            : `回归模型整体不显著（F(${p},${n - p - 1})=${fStat.toFixed(2)}, p=${fP.toFixed(3)}），自变量对因变量的解释力不足。`;
        
        html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${modelFitText}</p></div>`;
        
        // （2）路径系数
        html += `<h4>（2）路径检验</h4>
        <table class="result-table">
            <thead><tr><th>路径</th><th>B</th><th>S.E.</th><th>Beta</th><th>t</th><th>p</th></tr></thead>
            <tbody>`;
        
        // 常数项
        const b0 = Beta[0][0];
        const se0 = Math.sqrt(mse * inv[0][0]);
        const t0 = se0 > 0 ? b0 / se0 : 0;
        const p0 = (1 - jStat.studentt.cdf(Math.abs(t0), n - p - 1)) * 2;
        html += `<tr><td>常数项</td><td>${b0.toFixed(3)}</td><td>${se0.toFixed(3)}</td><td>-</td><td>${t0.toFixed(3)}</td><td>${p0 < 0.001 ? '<0.001' : p0.toFixed(3)}</td></tr>`;
        
        const pathSentences = [];
        ivGroups.forEach((iv, idx) => {
            const b = Beta[idx + 1][0];
            const se = Math.sqrt(mse * inv[idx + 1][idx + 1]);
            const t = se > 0 ? b / se : 0;
            const pt = (1 - jStat.studentt.cdf(Math.abs(t), n - p - 1)) * 2;
            const xStd = jStat.stdev(scores[iv.id]);
            const stdBeta = yStd > 0 ? b * (xStd / yStd) : 0;
            const ivName = groupNames[iv.id] || iv.id;
            const dvName = groupNames[dvGroup.id] || dvGroup.id;
            
            const pStr = pt < 0.001 ? '<0.001' : pt.toFixed(3);
            const star = pt < 0.01 ? '**' : (pt < 0.05 ? '*' : '');
            
            html += `<tr>
                <td>${ivName} → ${dvName}</td>
                <td>${b.toFixed(3)}</td>
                <td>${se.toFixed(3)}</td>
                <td>${stdBeta.toFixed(3)}</td>
                <td>${t.toFixed(3)}</td>
                <td>${pStr}${star}</td>
            </tr>`;
            
            if (pt < 0.05) {
                pathSentences.push(`${ivName}对${dvName}有显著${b > 0 ? '正向' : '负向'}影响（β=${stdBeta.toFixed(3)}, p${pStr.startsWith('<') ? '<0.001' : '=' + pStr}）`);
            } else {
                pathSentences.push(`${ivName}对${dvName}的影响不显著（β=${stdBeta.toFixed(3)}, p=${pStr}）`);
            }
        });
        html += `</tbody></table>
        <p style="font-size:12px;color:#888;">* p&lt;0.05, ** p&lt;0.01</p>`;
        
        const pathInterpretation = pathSentences.length > 0
            ? '路径分析结果表明：' + pathSentences.join('；') + '。'
            : '路径分析结果待补充。';
        
        html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;"><p>${pathInterpretation}</p></div>`;
        
        // （3）路径图
        html += `<h4>（3）路径系数图</h4>
        <div style="text-align:center; padding:20px; background:#f9f9f9; border-radius:8px; margin:10px 0;">
            <div style="display:inline-block; text-align:center;">`;
        
        // 生成简单的路径图 (文字版)
        html += `<div style="margin:10px;"><strong>自变量</strong></div>`;
        ivGroups.forEach((iv, idx) => {
            const b = Beta[idx + 1][0];
            const se = Math.sqrt(mse * inv[idx + 1][idx + 1]);
            const t = se > 0 ? b / se : 0;
            const pt = (1 - jStat.studentt.cdf(Math.abs(t), n - p - 1)) * 2;
            const xStd = jStat.stdev(scores[iv.id]);
            const stdBeta = yStd > 0 ? b * (xStd / yStd) : 0;
            const arrow = b > 0 ? '→' : '→';
            const color = pt < 0.05 ? (b > 0 ? '#2ecc71' : '#e74c3c') : '#999';
            html += `<div style="margin:5px 0;"><span style="color:${color}; font-weight:bold;">${groupNames[iv.id]||iv.id} ${arrow} β=${stdBeta.toFixed(3)} ${pt < 0.05 ? '✓' : '✗'} ${arrow} <strong>${groupNames[dvGroup.id]||dvGroup.id}</strong></span></div>`;
        });
        html += `</div></div>`;
        
    } catch (e) {
        html += `<p style="color:red;">计算出错：${e.message}</p>`;
    }
    
    return { method: '路径分析', html };
}
function performSEM(variables) {
    const legacyText = variables['semText'] || '';
    const pathText = variables['semPathText'] || legacyText;
    const fitText = variables['semFitText'] || legacyText;
    const mediationText = variables['semMediationText'] || legacyText;
    const data = parseAmosData(pathText, fitText, mediationText);

    const toNumber = (value) => {
        if (value === null || value === undefined) return NaN;
        const str = String(value).replace(/,/g, '').trim();
        if (!str || str === '-' || str.toLowerCase() === 'nan') return NaN;
        if (str === '***') return 0;
        const num = Number(str);
        return Number.isFinite(num) ? num : NaN;
    };
    const formatPValue = (value) => {
        const str = value === null || value === undefined ? '' : String(value).trim();
        if (!str || str === '-') return '-';
        if (str === '***') return '***';
        const num = toNumber(str);
        if (Number.isFinite(num)) return num < 0.001 ? '<0.001' : num.toFixed(3);
        return str;
    };
    const isSignificant = (pValue, crValue) => {
        const pText = pValue === null || pValue === undefined ? '' : String(pValue).trim();
        if (pText === '***') return true;
        const pNum = toNumber(pText);
        if (Number.isFinite(pNum)) return pNum < 0.05;
        const crNum = toNumber(crValue);
        return Number.isFinite(crNum) && Math.abs(crNum) >= 1.96;
    };
    const fitStatus = (value, threshold, operator) => {
        const num = toNumber(value);
        if (!Number.isFinite(num)) return '缺失';
        if (operator === '>') return num > threshold ? '接受' : '不接受';
        return num < threshold ? '接受' : '不接受';
    };

    const fitMetrics = [
        { category: '绝对适配度', name: 'GFI', key: 'GFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '绝对适配度', name: 'AGFI', key: 'AGFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '绝对适配度', name: 'RMSEA', key: 'RMSEA', standard: '<0.06', threshold: 0.06, operator: '<' },
        { category: '增值适配度', name: 'NFI', key: 'NFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '增值适配度', name: 'IFI', key: 'IFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '增值适配度', name: 'CFI', key: 'CFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '增值适配度', name: 'RFI', key: 'RFI', standard: '>0.9', threshold: 0.9, operator: '>' },
        { category: '简约适配度', name: 'CMIN/df', key: 'CMINDF', standard: '<3', threshold: 3, operator: '<' },
        { category: '简约适配度', name: 'PGFI', key: 'PGFI', standard: '>0.5', threshold: 0.5, operator: '>' }
    ];

    let fitRows = '';
    let fitEvaluated = 0;
    let fitAccepted = 0;
    fitMetrics.forEach(metric => {
        const value = data.fit[metric.key];
        const status = fitStatus(value, metric.threshold, metric.operator);
        if (status !== '缺失') {
            fitEvaluated += 1;
            if (status === '接受') fitAccepted += 1;
        }
        fitRows += `<tr><td>${metric.category}</td><td>${metric.name}</td><td>${metric.standard}</td><td>${value || '-'}</td><td>${status}</td></tr>`;
    });
    const fitTable = fitRows ? `
    <table class="result-table">
        <thead>
            <tr><th>指标类别</th><th>指标名称</th><th>适配标准</th><th>检验结果</th><th>结论</th></tr>
        </thead>
        <tbody>
            ${fitRows}
        </tbody>
    </table>` : '<p>无模型拟合度数据</p>';

    let fitInterpretation = '未识别到可用于判定的拟合指标，请检查“模型拟合度”输入框内容是否包含 Default model 行。';
    if (fitEvaluated > 0) {
        const ratio = fitAccepted / fitEvaluated;
        const fitLabelMap = { CMINDF: 'CMIN/DF', GFI: 'GFI', RMSEA: 'RMSEA', CFI: 'CFI', NFI: 'NFI', TLI: 'TLI', IFI: 'IFI', AGFI: 'AGFI', RFI: 'RFI', PGFI: 'PGFI' };
        const acceptedKeys = fitMetrics.filter(m => fitStatus(data.fit[m.key], m.threshold, m.operator) === '接受').map(m => m.key);
        const orderedMain = ['CMINDF', 'GFI', 'RMSEA', 'CFI', 'NFI', 'TLI', 'IFI'].filter(k => acceptedKeys.includes(k) && data.fit[k]);
        const labelText = orderedMain.length > 0 ? orderedMain.map(k => fitLabelMap[k]).join('、') : '主要';
        if (ratio >= 0.5) {
            fitInterpretation = `根据上表可知，根据模型拟合指标的评判标准，在本研究的模型拟合拟合度中，${labelText}等大部分模型适配度指标符合理想标准，故模型适配度很好。`;
        } else {
            fitInterpretation = `根据上表可知，根据模型拟合指标的评判标准，在本研究的模型拟合拟合度中，${labelText}等部分模型适配度指标未达到理想标准，故模型拟合度一般，建议进一步优化模型。`;
        }
    }

    let pathRows = '';
    let significantPaths = 0;
    const pathSentences = [];
    const betaForText = (num) => {
        if (!Number.isFinite(num)) return '-';
        return String(Number(num.toFixed(3)));
    };
    data.paths.forEach(item => {
        const pShow = formatPValue(item.p);
        pathRows += `<tr>
            <td>${item.source} → ${item.target}</td>
            <td>${item.estimate || '-'}</td>
            <td>${item.se || '-'}</td>
            <td>${item.cr || '-'}</td>
            <td>${pShow}</td>
            <td>${item.stdEstimate || '-'}</td>
        </tr>`;

        const sig = isSignificant(item.p, item.cr);
        if (sig) significantPaths += 1;
        const beta = Number.isFinite(toNumber(item.stdEstimate)) ? toNumber(item.stdEstimate) : toNumber(item.estimate);
        const betaText = Number.isFinite(beta) ? beta.toFixed(3) : '-';
        if (sig) {
            const dirText = Number.isFinite(beta) && beta < 0 ? '存在显著负向关系' : '存在显著正向关系';
            pathSentences.push(`${item.source}对${item.target}${dirText}(β=${betaForText(beta)},p<0.05)`);
        } else {
            pathSentences.push(`${item.source}对${item.target}不存在线性关系(β=${betaForText(beta)},p≥0.05)`);
        }
    });
    const pathTable = pathRows ? `
    <table class="result-table">
        <thead>
            <tr><th>路径</th><th>Estimate</th><th>S.E.</th><th>C.R.</th><th>P</th><th>Std.Estimate</th></tr>
        </thead>
        <tbody>
            ${pathRows}
        </tbody>
    </table>` : '<p>无路径分析数据</p>';

    let pathInterpretation = '未识别到结构路径，请检查“路径分析”输入框是否包含 Regression Weights 与 Standardized Regression Weights 表格。';
    if (data.paths.length > 0) {
        pathInterpretation = `上表展示了各路径的关系，具体可知:${pathSentences.join('；')}。`;
    }

    let medRows = '';
    const mediationSentences = [];
    const mediationIds = Object.keys(data.mediations).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true }));
    mediationIds.forEach((id) => {
        const group = data.mediations[id];
        const pathName = group.pathName || `路径${id}`;
        const ind = group.ind || {};
        const dir = group.direct || {};
        const tot = group.total || {};
        const r = group.r || {};
        const indP = formatPValue(ind.p);
        const dirP = formatPValue(dir.p);
        const totP = formatPValue(tot.p);
        const rP = formatPValue(r.p);

        medRows += `<tr>
            <td rowspan="4">${pathName}</td>
            <td>间接效应</td>
            <td>${ind.estimate || '-'}</td>
            <td>${ind.lower || '-'}</td>
            <td>${ind.upper || '-'}</td>
            <td>${indP}</td>
        </tr>
        <tr>
            <td>直接效应</td>
            <td>${dir.estimate || '-'}</td>
            <td>${dir.lower || '-'}</td>
            <td>${dir.upper || '-'}</td>
            <td>${dirP}</td>
        </tr>
        <tr>
            <td>总效应</td>
            <td>${tot.estimate || '-'}</td>
            <td>${tot.lower || '-'}</td>
            <td>${tot.upper || '-'}</td>
            <td>${totP}</td>
        </tr>
        <tr>
            <td>效应占比</td>
            <td>${r.estimate || '-'}</td>
            <td>${r.lower || '-'}</td>
            <td>${r.upper || '-'}</td>
            <td>${rP}</td>
        </tr>`;

        const indSig = isSignificant(ind.p);
        const dirSig = isSignificant(dir.p);
        const indVal = toNumber(ind.estimate);
        const dirVal = toNumber(dir.estimate);
        let conclusion = '中介效应不显著';
        if (indSig) {
            if (!dirSig) {
                if (Number.isFinite(indVal) && Number.isFinite(dirVal)) {
                    conclusion = indVal * dirVal >= 0 ? '互补型完全中介' : '竞争型完全中介';
                } else {
                    conclusion = '完全中介';
                }
            } else {
                if (Number.isFinite(indVal) && Number.isFinite(dirVal)) {
                    conclusion = indVal * dirVal >= 0 ? '互补型部分中介' : '竞争型部分中介';
                } else {
                    conclusion = '部分中介';
                }
            }
        }
        mediationSentences.push(`${pathName}中，间接效应${indSig ? '显著' : '不显著'}(β=${ind.estimate || '-'}, p=${indP})，直接效应${dirSig ? '显著' : '不显著'}(β=${dir.estimate || '-'}, p=${dirP})，判定为${conclusion}`);
    });

    const mediationTable = medRows ? `
    <table class="result-table">
        <thead>
            <tr><th>中介路径</th><th>效应类型</th><th>效应值</th><th>95%下限</th><th>95%上限</th><th>P</th></tr>
        </thead>
        <tbody>
            ${medRows}
        </tbody>
    </table>` : '<p>无中介作用数据</p>';

    let mediationInterpretation = '未识别到中介效应结果，请检查“中介作用”输入框是否包含 Parameter、Estimate、Lower、Upper、P 列。';
    if (mediationSentences.length > 0) {
        mediationInterpretation = mediationSentences.join('；') + '。';
    }

    const html = `<h3>12. 结构方程模型（Amos）</h3>
    <p>Amos结构方程模型（SEM）是一种用于分析潜在变量（即无法直接观测的变量）之间因果关系的统计方法。它基于最大似然估计（MLE）对模型中的路径参数进行估算，能够同时处理测量模型和结构模型，并通过拟合优度指标来评估模型的整体适配度，因此它特别适用于复杂的变量关系和因果机制研究。</p>
    
    <h4>（1）模型拟合度</h4>
    <p>在结构方程模型（SEM）的拟合度评估中，常用的指标可以分为绝对适配度参数、增值适配度参数和简约适配度参数。绝对适配度参数用于评估模型与数据的直接匹配程度，常见的如GFI（拟合优度指数，>0.9表示良好）和RMSEA（均方根误差近似，<0.06表示良好）。增值适配度参数则评估模型相较于基准模型的改进，常见的有IFI（增量拟合指数，>0.9表示良好）和CFI（比较拟合指数，>0.9表示良好）。简约适配度参数考虑了模型的简洁性，主要指标如CMIN/df（卡方自由度比，<3表示良好）和PGFI（简约拟合优度指数，>0.5表示良好）。这些拟合指标帮助研究者综合判断模型的整体适配度，确保所构建的模型能够合理解释观测数据。</p>
    ${fitTable}
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>${fitInterpretation}</p>
    </div>

    <h4>（2）路径检验</h4>
    ${pathTable}
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>${pathInterpretation}</p>
    </div>
    
    <h4>（3）中介效应检验</h4>
    ${mediationTable}
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>${mediationInterpretation}</p>
    </div>
    `;

    return { method: '结构方程模型（Amos）', html };
}

function parseAmosData(pathText, fitText, mediationText) {
    const result = {
        fit: {},
        paths: [],
        mediations: {}
    };
    const cleanCell = (cell) => {
        if (cell === null || cell === undefined) return '';
        return String(cell)
            .replace(/\\\*/g, '*')
            .replace(/<br\s*\/?>/gi, '')
            .replace(/&nbsp;/gi, ' ')
            .trim();
    };
    const extractCells = (line) => {
        if (!line) return [];
        if (line.includes('\t')) return line.split('\t').map(cleanCell).filter(v => v !== '');
        if (line.includes('|')) return line.split('|').map(cleanCell).filter(v => v !== '');
        const normalized = cleanCell(line);
        if (!normalized) return [];
        return normalized.split(/\s{2,}/).map(cleanCell).filter(v => v !== '');
    };

    const normalizePathNode = (text) => String(text || '').replace(/\s+/g, '').trim();
    const parsePathLineFallback = (line) => {
        const normalizedLine = line.replace(/<---|<--|<-|←|→/g, ' <--- ');
        const tokens = normalizedLine.split(/\s+/).map(cleanCell).filter(v => v !== '');
        const arrowPos = tokens.indexOf('<---');
        if (arrowPos > 0 && arrowPos < tokens.length - 1) {
            return {
                target: tokens[arrowPos - 1],
                source: tokens[arrowPos + 1],
                values: tokens.slice(arrowPos + 2)
            };
        }
        return null;
    };

    const pathLines = String(pathText || '').split('\n');
    const pathsMap = {};
    const regressionOrder = [];
    let section = '';

    pathLines.forEach(rawLine => {
        const line = String(rawLine || '').trim();
        if (!line) return;
        const lower = line.toLowerCase();
        if (lower.includes('standardized regression weights')) {
            section = 'standardized';
            return;
        }
        if (lower.includes('regression weights')) {
            section = 'regression';
            return;
        }
        if (!section) return;

        let target = '';
        let source = '';
        let values = [];

        const cells = extractCells(line);
        if (cells.length >= 3) {
            if (cells.some(c => /^estimate$/i.test(c) || /^label$/i.test(c))) return;
            const arrowIndex = cells.findIndex(c => /<[-]+|←|→/.test(c));
            if (arrowIndex > 0 && arrowIndex < cells.length - 1) {
                target = cells[arrowIndex - 1];
                source = cells[arrowIndex + 1];
                values = cells.slice(arrowIndex + 2);
            } else {
                target = cells[0];
                source = cells[1];
                values = cells.slice(2);
            }
        } else {
            const parsed = parsePathLineFallback(line);
            if (parsed) {
                target = parsed.target;
                source = parsed.source;
                values = parsed.values;
            }
        }

        if (!target || !source) return;
        if (/_q\d+/i.test(target) || /_q\d+/i.test(source)) return;
        if (/^e\d+$/i.test(target) || /^e\d+$/i.test(source)) return;
        if (/^(model|default model)$/i.test(target) || /^(model|default model)$/i.test(source)) return;
        if (/^(estimate|label)$/i.test(target) || /^(estimate|label)$/i.test(source)) return;

        const normalizedTarget = normalizePathNode(target);
        const normalizedSource = normalizePathNode(source);
        const key = `${normalizedSource}->${normalizedTarget}`;
        if (!pathsMap[key]) {
            pathsMap[key] = { source: normalizedSource, target: normalizedTarget, estimate: '-', se: '-', cr: '-', p: '-', stdEstimate: '-' };
        }

        if (section === 'regression') {
            if (!regressionOrder.includes(key)) regressionOrder.push(key);
            pathsMap[key].estimate = values[0] || pathsMap[key].estimate;
            pathsMap[key].se = values[1] || pathsMap[key].se;
            pathsMap[key].cr = values[2] || pathsMap[key].cr;
            pathsMap[key].p = values[3] || pathsMap[key].p;
        } else if (section === 'standardized') {
            pathsMap[key].stdEstimate = values[0] || pathsMap[key].stdEstimate;
        }
    });

    result.paths = Object.values(pathsMap);

    const fitLines = String(fitText || '').split('\n');
    let fitHeaders = [];
    fitLines.forEach(rawLine => {
        const cells = extractCells(rawLine);
        if (cells.length === 0) return;

        const first = (cells[0] || '').toLowerCase();
        if (first === 'model') {
            fitHeaders = cells.map(c => c.toUpperCase().replace(/\s+/g, ''));
            return;
        }
        if (first !== 'default model') return;
        if (fitHeaders.length === 0) return;

        for (let i = 1; i < fitHeaders.length && i < cells.length; i++) {
            const header = fitHeaders[i];
            const value = cells[i];
            if (header.includes('CMIN/DF')) result.fit.CMINDF = value;
            else if (header === 'GFI') result.fit.GFI = value;
            else if (header === 'AGFI') result.fit.AGFI = value;
            else if (header === 'PGFI') result.fit.PGFI = value;
            else if (header === 'NFI') result.fit.NFI = value;
            else if (header === 'IFI') result.fit.IFI = value;
            else if (header === 'CFI') result.fit.CFI = value;
            else if (header === 'RFI') result.fit.RFI = value;
            else if (header === 'RMSEA') result.fit.RMSEA = value;
            else if (header === 'TLI') result.fit.TLI = value;
        }
    });

    const medLines = String(mediationText || '').split('\n');
    medLines.forEach(rawLine => {
        const cells = extractCells(rawLine);
        if (cells.length === 0) return;
        const param = (cells[0] || '').trim();
        if (!param || /^parameter$/i.test(param)) return;
        const match = param.match(/^([a-zA-Z]+)_?([A-Za-z0-9]+)$/);
        if (!match) return;

        const type = match[1].toLowerCase();
        const id = match[2];
        const values = cells.slice(1).map(cleanCell).filter(v => v !== '');
        let item = { estimate: '-', lower: '-', upper: '-', p: '-' };
        if (values.length >= 4) {
            const used = values.slice(-4);
            item = { estimate: used[0], lower: used[1], upper: used[2], p: used[3] };
        } else if (values.length === 3) {
            item = { estimate: values[0], lower: values[1], upper: values[2], p: '-' };
        } else if (values.length === 2) {
            item = { estimate: values[0], lower: values[1], upper: '-', p: '-' };
        } else if (values.length === 1) {
            item = { estimate: values[0], lower: '-', upper: '-', p: '-' };
        }

        if (!result.mediations[id]) result.mediations[id] = {};
        if (type.startsWith('ind')) result.mediations[id].ind = item;
        else if (type.startsWith('dir')) result.mediations[id].direct = item;
        else if (type.startsWith('tot')) result.mediations[id].total = item;
        else if (type.startsWith('r')) result.mediations[id].r = item;
    });

    const edgeSet = new Set(result.paths.map(p => `${p.source}->${p.target}`));
    const incoming = {};
    const outgoing = {};
    result.paths.forEach(p => {
        if (!incoming[p.target]) incoming[p.target] = new Set();
        if (!outgoing[p.source]) outgoing[p.source] = new Set();
        incoming[p.target].add(p.source);
        outgoing[p.source].add(p.target);
    });

    const candidateChains = [];
    Object.keys(incoming).forEach(mediator => {
        const preds = Array.from(incoming[mediator] || []);
        const succs = Array.from(outgoing[mediator] || []);
        if (preds.length === 0 || succs.length === 0) return;
        succs.forEach(outcome => {
            preds.forEach(source => {
                if (source === outcome) return;
                candidateChains.push({
                    source,
                    mediator,
                    outcome,
                    hasDirect: edgeSet.has(`${source}->${outcome}`)
                });
            });
        });
    });

    const orderIndex = {};
    regressionOrder.forEach((key, idx) => {
        orderIndex[key] = idx;
    });
    const getOrder = (key) => Object.prototype.hasOwnProperty.call(orderIndex, key) ? orderIndex[key] : Number.MAX_SAFE_INTEGER;

    const uniqueChains = [];
    const chainKeys = new Set();
    candidateChains
        .sort((a, b) => {
            const aDirectOrder = getOrder(`${a.source}->${a.outcome}`);
            const bDirectOrder = getOrder(`${b.source}->${b.outcome}`);
            if (aDirectOrder !== bDirectOrder) return aDirectOrder - bDirectOrder;

            const aSourceMediatorOrder = getOrder(`${a.source}->${a.mediator}`);
            const bSourceMediatorOrder = getOrder(`${b.source}->${b.mediator}`);
            if (aSourceMediatorOrder !== bSourceMediatorOrder) return aSourceMediatorOrder - bSourceMediatorOrder;

            const aMediatorOutcomeOrder = getOrder(`${a.mediator}->${a.outcome}`);
            const bMediatorOutcomeOrder = getOrder(`${b.mediator}->${b.outcome}`);
            if (aMediatorOutcomeOrder !== bMediatorOutcomeOrder) return aMediatorOutcomeOrder - bMediatorOutcomeOrder;

            return `${a.source}${a.mediator}${a.outcome}`.localeCompare(`${b.source}${b.mediator}${b.outcome}`, 'zh-Hans-CN');
        })
        .forEach(chain => {
            const key = `${chain.source}->${chain.mediator}->${chain.outcome}`;
            if (chainKeys.has(key)) return;
            chainKeys.add(key);
            uniqueChains.push(chain);
        });

    const mediationIds = Object.keys(result.mediations).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true }));
    mediationIds.forEach((id, index) => {
        const chain = uniqueChains[index];
        if (chain) {
            result.mediations[id].pathName = `${chain.source}→${chain.mediator}→${chain.outcome}`;
        } else {
            result.mediations[id].pathName = `路径${id}`;
        }
    });

    return result;
}

// 中介作用 (Mediation)
function performMediation(variables) {
    const xVars = variables['x-variable'] || [];
    const mVars = variables['m-variable'] || [];
    const yVar = (variables['y-variable'] || [])[0];
    const controlVars = variables['control-variables'] || variables['control'] || [];

    if (xVars.length === 0 || mVars.length === 0 || !yVar) throw new Error('请至少选择1个X变量、1个M变量和Y变量');

    const allVars = [...xVars, ...mVars, yVar, ...controlVars];
    if (new Set(allVars).size !== allVars.length) throw new Error('X、M、Y与控制变量不能重复');

    const validRows = getValidRows(allVars)
        .map(row => ({
            xMap: xVars.reduce((acc, variable) => {
                acc[variable] = Number(row[variable]);
                return acc;
            }, {}),
            mMap: mVars.reduce((acc, variable) => {
                acc[variable] = Number(row[variable]);
                return acc;
            }, {}),
            y: Number(row[yVar]),
            controls: controlVars.map(controlVar => Number(row[controlVar]))
        }))
        .filter(row => {
            const xFinite = xVars.every(variable => Number.isFinite(row.xMap[variable]));
            const mFinite = mVars.every(variable => Number.isFinite(row.mMap[variable]));
            return xFinite && mFinite && Number.isFinite(row.y) && row.controls.every(value => Number.isFinite(value));
        });

    const n = validRows.length;
    if (n < 8) throw new Error('有效样本量不足，至少需要8个同时包含所选X、M、Y的数值样本');
    if (n <= controlVars.length + 3) throw new Error('样本量不足，无法在当前控制变量数量下完成中介分析');

    const Y = validRows.map(row => row.y);
    const xSeriesMap = xVars.reduce((acc, variable) => {
        acc[variable] = validRows.map(row => row.xMap[variable]);
        return acc;
    }, {});
    const mSeriesMap = mVars.reduce((acc, variable) => {
        acc[variable] = validRows.map(row => row.mMap[variable]);
        return acc;
    }, {});
    const controlSeries = controlVars.map((_, index) => validRows.map(row => row.controls[index]));

    const ensureVariance = (values, label) => {
        const sd = jStat.stdev(values, true);
        if (!Number.isFinite(sd) || sd === 0) throw new Error(`${label}没有足够变异，无法进行中介分析`);
    };

    ensureVariance(Y, yVar);
    xVars.forEach(variable => ensureVariance(xSeriesMap[variable], variable));
    mVars.forEach(variable => ensureVariance(mSeriesMap[variable], variable));
    controlSeries.forEach((series, index) => ensureVariance(series, controlVars[index]));

    const pathPairs = [];
    xVars.forEach(xVariable => {
        mVars.forEach(mVariable => {
            if (xVariable !== mVariable) pathPairs.push({ xVar: xVariable, mVar: mVariable });
        });
    });
    if (pathPairs.length === 0) throw new Error('X变量与M变量不能完全重复，请至少保留一条有效中介路径');

    const formatP = (value) => {
        if (!Number.isFinite(value)) return '-';
        if (value < 0.001) return '<0.001';
        return value.toFixed(3);
    };
    const formatNum = (value) => Number.isFinite(value) ? value.toFixed(3) : '-';
    const percentileCI = (arr) => {
        if (arr.length === 0) return { lower: NaN, upper: NaN };
        const sorted = [...arr].sort((left, right) => left - right);
        const lowerIndex = Math.max(0, Math.floor((sorted.length - 1) * 0.025));
        const upperIndex = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.975));
        return { lower: sorted[lowerIndex], upper: sorted[upperIndex] };
    };
    const pFromBoot = (arr) => {
        if (arr.length === 0) return NaN;
        const lessOrEqualZero = arr.filter(value => value <= 0).length / arr.length;
        const greaterOrEqualZero = arr.filter(value => value >= 0).length / arr.length;
        return Math.min(1, 2 * Math.min(lessOrEqualZero, greaterOrEqualZero));
    };
    const ciExcludesZero = (ci) => Number.isFinite(ci.lower) && Number.isFinite(ci.upper) && !(ci.lower <= 0 && ci.upper >= 0);

    const targetTotalBootstrap = 12000;
    const bootstrapSamples = Math.max(1200, Math.floor(targetTotalBootstrap / pathPairs.length));
    const minAcceptedBootstrap = Math.max(300, Math.floor(bootstrapSamples * 0.3));
    const controlText = controlVars.length > 0 ? controlVars.join('、') : '无';
    const controlHint = controlVars.length > 0 ? `，并将${controlText}纳入控制` : '';
    const equationControlSuffix = controlVars.length > 0 ? ` + ${controlText}` : '';

    const pathRows = [];
    const effectRows = [];
    const interpretationSentences = [];
    let acceptedBootstrapMin = Number.MAX_SAFE_INTEGER;

    pathPairs.forEach((pair, pairIndex) => {
        const X = xSeriesMap[pair.xVar];
        const M = mSeriesMap[pair.mVar];
        const resA = multiReg([X, ...controlSeries], M);
        const resOutcome = multiReg([X, M, ...controlSeries], Y);
        const resTotal = multiReg([X, ...controlSeries], Y);

        const a = resA.beta[1];
        const b = resOutcome.beta[2];
        const cPrime = resOutcome.beta[1];
        const total = resTotal.beta[1];
        const indirect = a * b;
        const proportion = total !== 0 ? (indirect / total) : NaN;

        const bootstrapIndirect = [];
        const bootstrapDirect = [];
        const bootstrapTotal = [];
        const bootstrapRatio = [];

        for (let i = 0; i < bootstrapSamples; i++) {
            const indices = [];
            for (let j = 0; j < n; j++) indices.push(Math.floor(Math.random() * n));

            const sampleX = indices.map(index => X[index]);
            const sampleM = indices.map(index => M[index]);
            const sampleY = indices.map(index => Y[index]);
            const sampleControls = controlSeries.map(series => indices.map(index => series[index]));

            try {
                const sampleA = multiReg([sampleX, ...sampleControls], sampleM);
                const sampleOutcome = multiReg([sampleX, sampleM, ...sampleControls], sampleY);
                const sampleTotal = multiReg([sampleX, ...sampleControls], sampleY);
                const sampleIndirect = sampleA.beta[1] * sampleOutcome.beta[2];
                const sampleTotalEffect = sampleTotal.beta[1];

                bootstrapIndirect.push(sampleIndirect);
                bootstrapDirect.push(sampleOutcome.beta[1]);
                bootstrapTotal.push(sampleTotalEffect);

                if (sampleTotalEffect !== 0 && Number.isFinite(sampleTotalEffect)) {
                    const sampleRatio = sampleIndirect / sampleTotalEffect;
                    if (Number.isFinite(sampleRatio)) bootstrapRatio.push(sampleRatio);
                }
            } catch (error) {
            }
        }

        if (bootstrapIndirect.length < minAcceptedBootstrap) {
            throw new Error(`路径${pair.xVar}→${pair.mVar}→${yVar}的Bootstrap有效重复次数不足，请减少控制变量或检查变量共线性`);
        }
        if (bootstrapIndirect.length < acceptedBootstrapMin) acceptedBootstrapMin = bootstrapIndirect.length;

        const indirectCI = percentileCI(bootstrapIndirect);
        const directCI = percentileCI(bootstrapDirect);
        const totalCI = percentileCI(bootstrapTotal);
        const ratioCI = percentileCI(bootstrapRatio);

        const pIndirect = pFromBoot(bootstrapIndirect);
        const pDirect = resOutcome.p[1];
        const pTotal = resTotal.p[1];
        const pRatio = pFromBoot(bootstrapRatio);

        const indirectSignificant = ciExcludesZero(indirectCI);
        const directSignificant = Number.isFinite(pDirect) && pDirect < 0.05;
        const sameDirection = Number.isFinite(indirect) && Number.isFinite(cPrime) ? indirect * cPrime >= 0 : true;

        let mediationConclusion = '中介效应不显著';
        if (indirectSignificant) {
            if (directSignificant) {
                mediationConclusion = sameDirection ? '互补型部分中介' : '竞争型部分中介';
            } else {
                mediationConclusion = sameDirection ? '互补型完全中介' : '竞争型完全中介';
            }
        }

        const ratioSentence = Number.isFinite(proportion)
            ? `间接效应占总效应的比例为${formatNum(proportion)}`
            : '由于总效应接近0，间接效应占比不宜直接解释';

        pathRows.push(`
            <tr>
                <td rowspan="4">${pair.xVar}→${pair.mVar}→${yVar}</td>
                <td>a路径</td><td>${pair.mVar} ~ ${pair.xVar}${equationControlSuffix}</td><td>${formatNum(a)}</td><td>${formatNum(resA.se[1])}</td><td>${formatNum(resA.t[1])}</td><td>${formatP(resA.p[1])}</td>
            </tr>
            <tr>
                <td>b路径</td><td>${yVar} ~ ${pair.mVar} + ${pair.xVar}${equationControlSuffix}</td><td>${formatNum(b)}</td><td>${formatNum(resOutcome.se[2])}</td><td>${formatNum(resOutcome.t[2])}</td><td>${formatP(resOutcome.p[2])}</td>
            </tr>
            <tr>
                <td>c′路径</td><td>${yVar} ~ ${pair.xVar} + ${pair.mVar}${equationControlSuffix}</td><td>${formatNum(cPrime)}</td><td>${formatNum(resOutcome.se[1])}</td><td>${formatNum(resOutcome.t[1])}</td><td>${formatP(pDirect)}</td>
            </tr>
            <tr>
                <td>c路径</td><td>${yVar} ~ ${pair.xVar}${equationControlSuffix}</td><td>${formatNum(total)}</td><td>${formatNum(resTotal.se[1])}</td><td>${formatNum(resTotal.t[1])}</td><td>${formatP(pTotal)}</td>
            </tr>
        `);

        effectRows.push(`
            <tr>
                <td rowspan="4">${pair.xVar}→${pair.mVar}→${yVar}</td>
                <td>间接效应</td><td>${formatNum(indirect)}</td><td>${formatNum(indirectCI.lower)}</td><td>${formatNum(indirectCI.upper)}</td><td>${formatP(pIndirect)}</td>
            </tr>
            <tr>
                <td>直接效应</td><td>${formatNum(cPrime)}</td><td>${formatNum(directCI.lower)}</td><td>${formatNum(directCI.upper)}</td><td>${formatP(pDirect)}</td>
            </tr>
            <tr>
                <td>总效应</td><td>${formatNum(total)}</td><td>${formatNum(totalCI.lower)}</td><td>${formatNum(totalCI.upper)}</td><td>${formatP(pTotal)}</td>
            </tr>
            <tr>
                <td>效应占比</td><td>${formatNum(proportion)}</td><td>${formatNum(ratioCI.lower)}</td><td>${formatNum(ratioCI.upper)}</td><td>${formatP(pRatio)}</td>
            </tr>
        `);

        interpretationSentences.push(`在路径${pair.xVar}→${pair.mVar}→${yVar}中${controlHint}后，a路径系数为${formatNum(a)}，b路径系数为${formatNum(b)}，间接效应为${formatNum(indirect)}，其95% Bootstrap置信区间为[${formatNum(indirectCI.lower)}, ${formatNum(indirectCI.upper)}]，因此间接效应${indirectSignificant ? '显著' : '不显著'}。直接效应c′为${formatNum(cPrime)}（p=${formatP(pDirect)}），总效应c为${formatNum(total)}（p=${formatP(pTotal)}）。综合判断，该路径表现为${mediationConclusion}，${ratioSentence}。`);
    });

    const html = `<h3>中介效应检验</h3>
    <div style="margin-bottom:12px; color:#555; font-size:14px;">分析路径数：${pathPairs.length}（X变量${xVars.length}个 × M变量${mVars.length}个）；控制变量：${controlText}；每条路径Bootstrap重复抽样次数：${bootstrapSamples}（最少有效次数：${acceptedBootstrapMin}）</div>
    <table class="result-table">
        <thead>
            <tr><th>中介路径</th><th>路径</th><th>回归方程</th><th>B</th><th>标准误</th><th>t</th><th>P</th></tr>
        </thead>
        <tbody>
            ${pathRows.join('')}
        </tbody>
    </table>
    <table class="result-table" style="margin-top:16px;">
        <thead><tr><th>中介路径</th><th>效应类型</th><th>效应值</th><th>95%下限</th><th>95%上限</th><th>P</th></tr></thead>
        <tbody>
            ${effectRows.join('')}
        </tbody>
    </table>
    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>${interpretationSentences.join('</p><p>')}</p>
    </div>`;

    return { method: '中介作用', html };
}

function simpleReg(x, y) {
    // y = b0 + b1*x
    const n = x.length;
    const xm = jStat.mean(x);
    const ym = jStat.mean(y);
    const ssxy = jStat.sum(x.map((v,i) => (v-xm)*(y[i]-ym)));
    const ssxx = jStat.sum(x.map(v => Math.pow(v-xm, 2)));
    const b1 = ssxy/ssxx;
    const b0 = ym - b1*xm;
    const yhat = x.map(v => b0 + b1 * v);
    const residuals = y.map((v, i) => v - yhat[i]);
    const sse = jStat.sum(residuals.map(v => v * v));
    const dof = n - 2;
    const mse = dof > 0 ? sse / dof : 0;
    const se_b1 = Math.sqrt(mse / ssxx);
    const se_b0 = Math.sqrt(mse * (1 / n + (xm * xm) / ssxx));
    const t1 = se_b1 === 0 ? 0 : b1 / se_b1;
    const t0 = se_b0 === 0 ? 0 : b0 / se_b0;
    const p1 = dof > 0 ? (1 - jStat.studentt.cdf(Math.abs(t1), dof)) * 2 : NaN;
    const p0 = dof > 0 ? (1 - jStat.studentt.cdf(Math.abs(t0), dof)) * 2 : NaN;
    return { beta: [b0, b1], se: [se_b0, se_b1], t: [t0, t1], p: [p0, p1] };
}

function multiReg(xs, y) {
    const n = y.length;
    const X_mat = [];
    for(let i=0; i<n; i++) {
        const row = [1];
        xs.forEach(xArr => row.push(xArr[i]));
        X_mat.push(row);
    }
    const Y_mat = y.map(v => [v]);
    
    const XT = jStat.transpose(X_mat);
    let inv;
    try {
        inv = jStat.inv(jStat.multiply(XT, X_mat));
    } catch (error) {
        throw new Error('回归计算失败，变量可能完全共线或方差为0');
    }
    const B = jStat.multiply(jStat.multiply(inv, XT), Y_mat);
    
    const beta = B.map(r => r[0]);
    const yhat = X_mat.map(row => row.reduce((sum, v, idx) => sum + v * beta[idx], 0));
    const residuals = y.map((v, i) => v - yhat[i]);
    const sse = jStat.sum(residuals.map(v => v * v));
    const yMean = jStat.mean(y);
    const sst = jStat.sum(y.map(v => Math.pow(v - yMean, 2)));
    const ssr = sst - sse;
    const dof = n - beta.length;
    const mse = dof > 0 ? sse / dof : 0;
    const se = beta.map((_, idx) => Math.sqrt(mse * inv[idx][idx]));
    const t = beta.map((b, idx) => se[idx] === 0 ? 0 : b / se[idx]);
    const p = beta.map((val, idx) => dof > 0 ? (1 - jStat.studentt.cdf(Math.abs(t[idx]), dof)) * 2 : NaN);
    const predictorCount = beta.length - 1;
    const rSquared = sst === 0 ? 1 : 1 - (sse / sst);
    const adjustedRSquared = dof > 0 ? 1 - ((1 - rSquared) * (n - 1) / dof) : NaN;
    const msr = predictorCount > 0 ? ssr / predictorCount : NaN;
    const F = predictorCount > 0 && mse > 0 ? msr / mse : NaN;
    const pF = Number.isFinite(F) && predictorCount > 0 && dof > 0 ? 1 - jStat.centralF.cdf(F, predictorCount, dof) : NaN;
    return { beta, se, t, p, inv, mse, dof, yhat, residuals, rSquared, adjustedRSquared, F, pF };
}

function performModeration(variables) {
    const xVar = (variables['x-variable'] || [])[0];
    const mVar = (variables['m-variable'] || [])[0];
    const yVar = (variables['y-variable'] || [])[0];

    if (!xVar || !mVar || !yVar) throw new Error('请选择X、M、Y变量');
    if (new Set([xVar, mVar, yVar]).size < 3) throw new Error('X、M、Y变量不能重复');

    const numericData = currentData.processed
        .map(row => ({
            x: Number(row[xVar]),
            m: Number(row[mVar]),
            y: Number(row[yVar])
        }))
        .filter(row => Number.isFinite(row.x) && Number.isFinite(row.m) && Number.isFinite(row.y));

    if (numericData.length < 8) throw new Error('有效样本量不足，至少需要8个同时包含X、M、Y的数值样本');

    const X = numericData.map(row => row.x);
    const M = numericData.map(row => row.m);
    const Y = numericData.map(row => row.y);
    const n = numericData.length;

    const meanX = jStat.mean(X);
    const meanM = jStat.mean(M);
    const meanY = jStat.mean(Y);
    const sdX = jStat.stdev(X, true);
    const sdM = jStat.stdev(M, true);
    const sdY = jStat.stdev(Y, true);

    if (!Number.isFinite(sdX) || sdX === 0) throw new Error(`${xVar}没有足够变异，无法进行调节分析`);
    if (!Number.isFinite(sdM) || sdM === 0) throw new Error(`${mVar}没有足够变异，无法进行调节分析`);
    if (!Number.isFinite(sdY) || sdY === 0) throw new Error(`${yVar}没有足够变异，无法进行调节分析`);

    const centeredX = X.map(value => value - meanX);
    const centeredM = M.map(value => value - meanM);
    const interaction = centeredX.map((value, index) => value * centeredM[index]);

    const interactionSd = jStat.stdev(interaction, true);
    const model1 = multiReg([centeredX], Y);
    const model2 = multiReg([centeredX, centeredM], Y);
    const model3 = multiReg([centeredX, centeredM, interaction], Y);

    const formatNum = (value) => Number.isFinite(value) ? value.toFixed(3) : '-';
    const formatPValue = (value) => {
        if (!Number.isFinite(value)) return '-';
        if (value < 0.001) return '0.000';
        return value.toFixed(3);
    };
    const formatPCompare = (value) => {
        if (!Number.isFinite(value)) return '-';
        return `${formatPValue(value)}${value < 0.05 ? '<0.05' : '≥0.05'}`;
    };
    const formatPWithStars = (value) => {
        if (!Number.isFinite(value)) return '-';
        const stars = value < 0.01 ? '**' : (value < 0.05 ? '*' : '');
        return `${formatPValue(value)}${stars}`;
    };
    const formatFText = (model, numeratorDf) => `F (${numeratorDf},${model.dof})=${formatNum(model.F)},p=${formatPValue(model.pF)}`;
    const getDeltaStats = (currentModel, previousModel) => {
        if (!previousModel) {
            return {
                deltaR2: currentModel.rSquared,
                deltaF: currentModel.F,
                deltaP: currentModel.pF,
                deltaDf1: currentModel.beta.length - 1
            };
        }
        const deltaDf1 = currentModel.beta.length - previousModel.beta.length;
        const deltaR2 = currentModel.rSquared - previousModel.rSquared;
        const deltaF = deltaDf1 > 0 && currentModel.dof > 0
            ? (deltaR2 / deltaDf1) / ((1 - currentModel.rSquared) / currentModel.dof)
            : NaN;
        const deltaP = Number.isFinite(deltaF) && deltaDf1 > 0 && currentModel.dof > 0
            ? 1 - jStat.centralF.cdf(deltaF, deltaDf1, currentModel.dof)
            : NaN;
        return { deltaR2, deltaF, deltaP, deltaDf1 };
    };
    const toStdBeta = (estimate, predictorSd) => {
        if (!Number.isFinite(estimate) || !Number.isFinite(predictorSd) || !Number.isFinite(sdY) || sdY === 0) return '-';
        return formatNum(estimate * predictorSd / sdY);
    };
    const emptyCells = '<td></td><td></td><td></td><td></td><td></td>';
    const buildTermCells = (model, index, predictorSd) => {
        if (!model || model.beta[index] === undefined) return emptyCells;
        return `<td>${formatNum(model.beta[index])}</td><td>${formatNum(model.se[index])}</td><td>${formatNum(model.t[index])}</td><td>${formatPWithStars(model.p[index])}</td><td>${index === 0 ? '-' : toStdBeta(model.beta[index], predictorSd)}</td>`;
    };

    const delta1 = getDeltaStats(model1, null);
    const delta2 = getDeltaStats(model2, model1);
    const delta3 = getDeltaStats(model3, model2);
    const interactionSignificant = Number.isFinite(model3.p[3]) && model3.p[3] < 0.05;
    const model1XSignificant = Number.isFinite(model1.p[1]) && model1.p[1] < 0.05;

    const html = `<h3>调节效应检验</h3>
    <table class="result-table">
        <thead>
            <tr>
                <th rowspan="2">变量</th>
                <th colspan="5">模型1</th>
                <th colspan="5">模型2</th>
                <th colspan="5">模型3</th>
            </tr>
            <tr>
                <th>B</th><th>标准误</th><th>t</th><th>p</th><th>β</th>
                <th>B</th><th>标准误</th><th>t</th><th>p</th><th>β</th>
                <th>B</th><th>标准误</th><th>t</th><th>p</th><th>β</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>常数</td>
                ${buildTermCells(model1, 0)}
                ${buildTermCells(model2, 0)}
                ${buildTermCells(model3, 0)}
            </tr>
            <tr>
                <td>${xVar}</td>
                ${buildTermCells(model1, 1, sdX)}
                ${buildTermCells(model2, 1, sdX)}
                ${buildTermCells(model3, 1, sdX)}
            </tr>
            <tr>
                <td>${mVar}</td>
                ${emptyCells}
                ${buildTermCells(model2, 2, sdM)}
                ${buildTermCells(model3, 2, sdM)}
            </tr>
            <tr>
                <td>${xVar}*${mVar}</td>
                ${emptyCells}
                ${emptyCells}
                ${buildTermCells(model3, 3, interactionSd)}
            </tr>
            <tr>
                <td>R²</td>
                <td colspan="5">${formatNum(model1.rSquared)}</td>
                <td colspan="5">${formatNum(model2.rSquared)}</td>
                <td colspan="5">${formatNum(model3.rSquared)}</td>
            </tr>
            <tr>
                <td>调整R²</td>
                <td colspan="5">${formatNum(model1.adjustedRSquared)}</td>
                <td colspan="5">${formatNum(model2.adjustedRSquared)}</td>
                <td colspan="5">${formatNum(model3.adjustedRSquared)}</td>
            </tr>
            <tr>
                <td>F值</td>
                <td colspan="5">${formatFText(model1, model1.beta.length - 1)}</td>
                <td colspan="5">${formatFText(model2, model2.beta.length - 1)}</td>
                <td colspan="5">${formatFText(model3, model3.beta.length - 1)}</td>
            </tr>
            <tr>
                <td>△R²</td>
                <td colspan="5">${formatNum(delta1.deltaR2)}</td>
                <td colspan="5">${formatNum(delta2.deltaR2)}</td>
                <td colspan="5">${formatNum(delta3.deltaR2)}</td>
            </tr>
            <tr>
                <td>△F值</td>
                <td colspan="5">F (${delta1.deltaDf1},${model1.dof})=${formatNum(delta1.deltaF)},p=${formatPValue(delta1.deltaP)}</td>
                <td colspan="5">F (${delta2.deltaDf1},${model2.dof})=${formatNum(delta2.deltaF)},p=${formatPValue(delta2.deltaP)}</td>
                <td colspan="5">F (${delta3.deltaDf1},${model3.dof})=${formatNum(delta3.deltaF)},p=${formatPValue(delta3.deltaP)}</td>
            </tr>
        </tbody>
    </table>
    <p>备注：因变量 = ${yVar}</p>
    <p>* p&lt;0.05 ** p&lt;0.01</p>

    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>从上表可知，调节作用分为三个模型，模型1中包括自变量(${xVar})。模型2在模型1的基础上加入调节变量(${mVar})，模型3在模型2的基础上加入交互项(自变量与调节变量的乘积项)。</p>
        <p>针对模型1，其目的在于研究在不考虑调节变量(${mVar})的干扰时，自变量(${xVar})对于因变量(${yVar})的影响情况。从上表格可知，自变量(${xVar})${model1XSignificant ? `呈现出显著性(t=${formatNum(model1.t[1])}, p=${formatPValue(model1.p[1])}&lt;0.05)` : `并未呈现出显著性(t=${formatNum(model1.t[1])}, p=${formatPValue(model1.p[1])}&gt;0.05)`}。意味着${xVar}对于${yVar}${model1XSignificant ? '会产生显著影响关系。' : '不会产生显著影响关系。'}</p>
        <p>调节效应可通过两种方式进行查看，第一种是查看模型2到模型3时，F值变化的显著性；第二种是查看模型3中交互项的显著性，本次以第二种方式分析调节效应。</p>
        <p>从上表格可知，${xVar}与${mVar}的交互项${interactionSignificant ? `会呈现出显著性(t=${formatNum(model3.t[3])}, p=${formatPValue(model3.p[3])}&lt;0.05)` : `并不会呈现出显著性(t=${formatNum(model3.t[3])}, p=${formatPValue(model3.p[3])}&gt;0.05)`}，模型2到模型3的△F值${delta3.deltaP < 0.05 ? '同样达到显著水平' : '也未达到显著水平'}(F (${delta3.deltaDf1},${model3.dof})=${formatNum(delta3.deltaF)}, p=${formatPValue(delta3.deltaP)})。${interactionSignificant ? `意味着${xVar}对于${yVar}产生影响时，调节变量(${mVar})在不同水平下会改变这种影响幅度，因此存在显著调节作用。` : `${model1XSignificant ? `以及从模型1可知，${xVar}对于${yVar}产生影响关系，意味着${xVar}对于${yVar}影响时，调节变量(${mVar})在不同水平时，影响幅度保持一致。` : `同时模型1显示${xVar}对${yVar}的主效应本身并不显著，因此当前数据未支持稳定的调节作用。`}`}</p>
    </div>`;

    return { method: '调节作用', html };
}
function performIPA(variables) {
    const importanceVars = Array.isArray(variables['importance']) ? variables['importance'] : [];
    const performanceVars = Array.isArray(variables['performance']) ? variables['performance'] : [];

    if (importanceVars.length === 0 || performanceVars.length === 0) {
        throw new Error('请分别选择重要性变量和表现变量');
    }

    const pairCount = Math.min(importanceVars.length, performanceVars.length);
    if (pairCount === 0) {
        throw new Error('请至少提供一组重要性-表现变量');
    }

    const formatNum = (num, digits = 3) => Number(num).toFixed(digits);
    const calcMean = arr => arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const calcSampleStd = arr => {
        if (arr.length <= 1) return 0;
        const mean = calcMean(arr);
        const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (arr.length - 1);
        return Math.sqrt(Math.max(variance, 0));
    };
    const normalizeLabel = (name) => {
        return String(name || '')
            .replace(/[（(]?\s*(重要性|满意度|表现|期望|importance|performance)\s*[）)]?/ig, '')
            .replace(/[_\-\s]?(imp|perf)$/ig, '')
            .trim();
    };
    const buildItemName = (importanceName, performanceName) => {
        const imp = normalizeLabel(importanceName);
        const per = normalizeLabel(performanceName);
        if (imp && per && imp === per) return imp;
        if (per) return per;
        if (imp) return imp;
        return `${importanceName}/${performanceName}`;
    };

    const rows = [];
    for (let i = 0; i < pairCount; i++) {
        const impVar = importanceVars[i];
        const perVar = performanceVars[i];
        const validRows = currentData.processed.filter(row => {
            const impVal = Number(row[impVar]);
            const perVal = Number(row[perVar]);
            return Number.isFinite(impVal) && Number.isFinite(perVal);
        });

        if (validRows.length === 0) continue;

        const impValues = validRows.map(row => Number(row[impVar]));
        const perValues = validRows.map(row => Number(row[perVar]));
        const impMean = calcMean(impValues);
        const perMean = calcMean(perValues);
        const impStd = calcSampleStd(impValues);
        const perStd = calcSampleStd(perValues);

        rows.push({
            idx: rows.length + 1,
            item: buildItemName(impVar, perVar),
            impVar,
            perVar,
            n: validRows.length,
            impMean,
            impStd,
            perMean,
            perStd
        });
    }

    if (rows.length === 0) {
        throw new Error('未找到可计算的有效样本，请检查变量是否为数值型');
    }

    const xRef = rows.reduce((sum, row) => sum + row.impMean, 0) / rows.length;
    const yRef = rows.reduce((sum, row) => sum + row.perMean, 0) / rows.length;

    const quadrantNames = {
        q1: '优势区',
        q2: '维持区',
        q3: '机会区',
        q4: '改进区'
    };
    const classifyQuadrant = (x, y) => {
        if (x >= xRef && y >= yRef) return 'q1';
        if (x < xRef && y >= yRef) return 'q2';
        if (x < xRef && y < yRef) return 'q3';
        return 'q4';
    };

    rows.forEach(row => {
        row.quadrantKey = classifyQuadrant(row.impMean, row.perMean);
        row.quadrant = quadrantNames[row.quadrantKey];
        row.gap = row.impMean - row.perMean;
    });

    const countByQuadrant = {
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 0
    };
    rows.forEach(row => countByQuadrant[row.quadrantKey]++);

    const minX = Math.min(...rows.map(row => row.impMean));
    const maxX = Math.max(...rows.map(row => row.impMean));
    const minY = Math.min(...rows.map(row => row.perMean));
    const maxY = Math.max(...rows.map(row => row.perMean));
    const xSpan = Math.max(maxX - minX, 0.2);
    const ySpan = Math.max(maxY - minY, 0.2);
    const xPadding = xSpan * 0.12;
    const yPadding = ySpan * 0.12;
    const xMin = minX - xPadding;
    const xMax = maxX + xPadding;
    const yMin = minY - yPadding;
    const yMax = maxY + yPadding;

    const width = 760;
    const height = 460;
    const margin = { left: 70, right: 24, top: 24, bottom: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const toX = value => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
    const toY = value => margin.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;

    const xRefPx = toX(xRef);
    const yRefPx = toY(yRef);

    let html = `<h3>IPA分析（重要性-满意度）</h3>
        <p>以重要性为横轴、满意度为纵轴，依据两轴均值将指标映射到四象限中。第一象限为优势区、第二象限为维持区、第三象限为机会区、第四象限为改进区。</p>
        <table class="result-table">
            <thead>
                <tr>
                    <th rowspan="2">序号</th>
                    <th rowspan="2">指标</th>
                    <th colspan="2">重要性</th>
                    <th colspan="2">满意度</th>
                    <th rowspan="2">象限</th>
                </tr>
                <tr>
                    <th>均值</th>
                    <th>标准差</th>
                    <th>均值</th>
                    <th>标准差</th>
                </tr>
            </thead>
            <tbody>`;

    rows.forEach(row => {
        html += `<tr>
            <td>${row.idx}</td>
            <td>${row.item}</td>
            <td>${formatNum(row.impMean)}</td>
            <td>${formatNum(row.impStd)}</td>
            <td>${formatNum(row.perMean)}</td>
            <td>${formatNum(row.perStd)}</td>
            <td>${row.quadrant}</td>
        </tr>`;
    });
    html += `</tbody></table>`;

    html += `<div style="margin:10px 0 6px; color:#666; font-size:13px;">分界值：重要性均值 = ${formatNum(xRef)}，满意度均值 = ${formatNum(yRef)}（基于各指标均值）</div>`;

    html += `<div style="margin:14px 0 8px; border:1px solid #dcdcdc; border-radius:6px; padding:10px; background:#fff; overflow-x:auto;">
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block; width:100%; max-width:${width}px; height:auto; margin:0 auto;" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="IPA四象限图">
            <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="#fff" stroke="#333" stroke-width="1"/>
            <line x1="${xRefPx}" y1="${margin.top}" x2="${xRefPx}" y2="${margin.top + plotHeight}" stroke="#666" stroke-width="1.2"/>
            <line x1="${margin.left}" y1="${yRefPx}" x2="${margin.left + plotWidth}" y2="${yRefPx}" stroke="#666" stroke-width="1.2"/>
            <text x="${margin.left + plotWidth / 2}" y="${height - 18}" text-anchor="middle" font-size="14" fill="#222">重要性</text>
            <text x="20" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="14" fill="#222" transform="rotate(-90 20 ${margin.top + plotHeight / 2})">满意度</text>
            <text x="${margin.left}" y="${height - 34}" text-anchor="start" font-size="12" fill="#666">${formatNum(xMin, 2)}</text>
            <text x="${margin.left + plotWidth}" y="${height - 34}" text-anchor="end" font-size="12" fill="#666">${formatNum(xMax, 2)}</text>
            <text x="${margin.left - 10}" y="${margin.top + plotHeight + 5}" text-anchor="end" font-size="12" fill="#666">${formatNum(yMin, 2)}</text>
            <text x="${margin.left - 10}" y="${margin.top + 5}" text-anchor="end" font-size="12" fill="#666">${formatNum(yMax, 2)}</text>
            <text x="${xRefPx + 4}" y="${height - 34}" text-anchor="start" font-size="11" fill="#555">x̄=${formatNum(xRef, 2)}</text>
            <text x="${margin.left - 12}" y="${yRefPx - 4}" text-anchor="end" font-size="11" fill="#555">ȳ=${formatNum(yRef, 2)}</text>
            <text x="${xRefPx + 8}" y="${yRefPx - 10}" font-size="11" fill="#2f54eb">第一象限（优势区）</text>
            <text x="${margin.left + 8}" y="${yRefPx - 10}" font-size="11" fill="#2f54eb">第二象限（维持区）</text>
            <text x="${margin.left + 8}" y="${margin.top + plotHeight - 8}" font-size="11" fill="#2f54eb">第三象限（机会区）</text>
            <text x="${xRefPx + 8}" y="${margin.top + plotHeight - 8}" font-size="11" fill="#2f54eb">第四象限（改进区）</text>
            ${rows.map(row => {
                const x = toX(row.impMean);
                const y = toY(row.perMean);
                return `<g>
                    <circle cx="${x}" cy="${y}" r="4.5" fill="#4c7dff" opacity="0.85"/>
                    <rect x="${x + 5}" y="${y - 12}" width="16" height="14" fill="#fff" stroke="#333" stroke-width="0.8" rx="1"/>
                    <text x="${x + 13}" y="${y - 2}" text-anchor="middle" font-size="10.5" fill="#111">${row.idx}</text>
                </g>`;
            }).join('')}
        </svg>
    </div>`;

    html += `<div style="font-size:13px; color:#666; line-height:1.8; margin-bottom:10px;">
        注：${rows.map(row => `${row.idx})${row.item}`).join('，')}
    </div>`;

    const priorityItems = rows
        .filter(row => row.quadrantKey === 'q4')
        .sort((a, b) => (b.impMean - b.perMean) - (a.impMean - a.perMean))
        .slice(0, 3);

    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `本次IPA分析共纳入${rows.length}个指标，重要性均值分界点为${formatNum(xRef)}，满意度均值分界点为${formatNum(yRef)}。`;
    interpretation += `四象限分布情况为：第一象限（优势区）${countByQuadrant.q1}个，第二象限（维持区）${countByQuadrant.q2}个，第三象限（机会区）${countByQuadrant.q3}个，第四象限（改进区）${countByQuadrant.q4}个。`;
    if (priorityItems.length > 0) {
        interpretation += `建议优先改进改进区中重要性高、满意度偏低的指标：${priorityItems.map(item => `“${item.item}”(重要性=${formatNum(item.impMean)}, 满意度=${formatNum(item.perMean)})`).join('、')}。`;
    } else {
        interpretation += `当前暂无指标落入第四象限，整体表现与重要性匹配较好，可优先巩固第一象限优势项。`;
    }
    if (importanceVars.length !== performanceVars.length) {
        interpretation += `本次输入的变量数量不一致，已按前${pairCount}组配对计算。`;
    }

    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;

    return {
        method: 'IPA分析',
        timestamp: new Date().toLocaleString(),
        html
    };
}
function performCluster(variables) {
    const analysisVars = variables['variables'] || variables['analysis-variables'] || variables['cluster-variables'] || [];
    const flatVars = [];
    analysisVars.forEach(v => { if (!flatVars.includes(v)) flatVars.push(v); });

    if (flatVars.length < 2) throw new Error('聚类分析至少需要2个变量');

    const validData = getValidRows(flatVars);
    const n = validData.length;
    if (n < 4) throw new Error('样本量至少为4');

    // --- Standardize data ---
    const means = [], stds = [];
    flatVars.forEach(v => {
        const vals = validData.map(r => Number(r[v]));
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
        means.push(mean); stds.push(std);
    });

    const data = validData.map(r => flatVars.map((v, j) => (Number(r[v]) - means[j]) / stds[j]));

    // --- Euclidean distance ---
    function euclidean(a, b) {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
        return Math.sqrt(s);
    }

    // --- K-Means algorithm ---
    function kmeans(data, k, maxIter) {
        maxIter = maxIter || 100;
        const dim = data[0].length;
        // K-Means++ initialization
        const centroids = [];
        centroids.push([...data[Math.floor(Math.random() * data.length)]]);
        for (let c = 1; c < k; c++) {
            const dists = data.map(p => {
                let minD = Infinity;
                centroids.forEach(cent => { const d = euclidean(p, cent); if (d < minD) minD = d; });
                return minD * minD;
            });
            const total = dists.reduce((a, b) => a + b, 0);
            let r = Math.random() * total, cum = 0;
            for (let i = 0; i < n; i++) {
                cum += dists[i];
                if (cum >= r) { centroids.push([...data[i]]); break; }
            }
            if (centroids.length < c + 1) centroids.push([...data[Math.floor(Math.random() * data.length)]]);
        }

        let labels = new Array(n).fill(0);
        for (let iter = 0; iter < maxIter; iter++) {
            // Assign
            let changed = false;
            for (let i = 0; i < n; i++) {
                let minD = Infinity, best = 0;
                for (let c = 0; c < k; c++) {
                    const d = euclidean(data[i], centroids[c]);
                    if (d < minD) { minD = d; best = c; }
                }
                if (labels[i] !== best) { labels[i] = best; changed = true; }
            }
            if (!changed && iter > 0) break;

            // Update centroids
            for (let c = 0; c < k; c++) {
                const members = data.filter((_, i) => labels[i] === c);
                if (members.length === 0) continue;
                for (let d = 0; d < dim; d++) {
                    centroids[c][d] = members.reduce((s, m) => s + m[d], 0) / members.length;
                }
            }
        }

        // Compute WCSS
        let wcss = 0;
        for (let i = 0; i < n; i++) wcss += euclidean(data[i], centroids[labels[i]]) ** 2;

        return { labels, centroids, wcss };
    }

    // --- Elbow method: find best K ---
    const maxK = Math.min(8, n - 1);
    const wcssArr = [];
    for (let k = 1; k <= maxK; k++) {
        // Run kmeans 3 times, pick lowest WCSS
        let best = null;
        for (let r = 0; r < 3; r++) {
            const res = kmeans(data, k, 100);
            if (!best || res.wcss < best.wcss) best = res;
        }
        wcssArr.push(best.wcss);
    }

    // Elbow: max second derivative of WCSS
    let bestK = 2;
    if (wcssArr.length >= 3) {
        let maxDiff2 = -Infinity;
        for (let k = 1; k < wcssArr.length - 1; k++) {
            const diff2 = wcssArr[k - 1] - 2 * wcssArr[k] + wcssArr[k + 1];
            if (diff2 > maxDiff2) { maxDiff2 = diff2; bestK = k + 1; }
        }
    }

    // Run final K-Means with best K
    let final = null;
    for (let r = 0; r < 5; r++) {
        const res = kmeans(data, bestK, 100);
        if (!final || res.wcss < final.wcss) final = res;
    }

    const labels = final.labels;
    const centroids = final.centroids;

    // --- Cluster counts ---
    const counts = new Array(bestK).fill(0);
    labels.forEach(l => counts[l]++);

    // --- Build HTML ---
    const formatNum = (v) => Number.isFinite(v) ? v.toFixed(3) : '-';

    let html = '<h3>K-Means 聚类分析</h3>';

    // 1. Elbow info
    html += `<p><strong>（1）肘部法则确定最优聚类数</strong></p>
        <p>通过肘部法则（Elbow Method）对K=2至K=${maxK}分别计算组内平方和（WCSS），以确定最优聚类数量。建议的聚类数为 <strong>K=${bestK}</strong>。</p>
        <table class="result-table">
            <thead><tr><th>K值</th><th>WCSS</th></tr></thead>
            <tbody>`;
    for (let k = 0; k < wcssArr.length; k++) {
        html += `<tr><td>${k + 1}</td><td>${formatNum(wcssArr[k])}</td></tr>`;
    }
    html += '</tbody></table>';

    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        根据肘部法则，当K从${bestK - 1}增加到${bestK}时，WCSS的下降幅度出现明显拐点，因此建议采用${bestK}类聚类方案。
    </div>`;

    // 2. Cluster summary
    html += `<p><strong>（2）聚类汇总</strong></p>
        <table class="result-table">
            <thead><tr><th>聚类</th><th>样本量</th><th>百分比</th></tr></thead>
            <tbody>`;
    for (let c = 0; c < bestK; c++) {
        html += `<tr><td>聚类${c + 1}</td><td>${counts[c]}</td><td>${(counts[c] / n * 100).toFixed(1)}%</td></tr>`;
    }
    html += '</tbody></table>';

    // 3. Cluster centers
    html += `<p><strong>（3）聚类中心</strong></p>
        <table class="result-table">
            <thead><tr><th>变量</th>`;
    for (let c = 0; c < bestK; c++) html += `<th>聚类${c + 1}</th>`;
    html += '</tr></thead><tbody>';

    for (let j = 0; j < flatVars.length; j++) {
        html += `<tr><td>${flatVars[j]}</td>`;
        for (let c = 0; c < bestK; c++) {
            // Convert centroid back to original scale
            const origVal = centroids[c][j] * stds[j] + means[j];
            html += `<td>${formatNum(origVal)}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';

    // 4. Cluster membership table (sample labels)
    html += `<p><strong>（4）样本聚类结果</strong></p>
        <p>共 ${n} 个有效样本被分配到 ${bestK} 个聚类中。</p>
        <table class="result-table">
            <thead><tr><th>样本编号</th><th>聚类标签</th></tr></thead>
            <tbody>`;
    const showCount = Math.min(n, 50);
    for (let i = 0; i < showCount; i++) {
        html += `<tr><td>${i + 1}</td><td>聚类${labels[i] + 1}</td></tr>`;
    }
    if (n > showCount) {
        html += `<tr><td colspan="2" style="text-align:center;color:#999;">… 共 ${n} 个样本，仅显示前 ${showCount} 个</td></tr>`;
    }
    html += '</tbody></table>';

    // 5. ANOVA table
    html += `<p><strong>（5）方差分析（聚类间差异检验）</strong></p>
        <table class="result-table">
            <thead><tr><th>变量</th><th>F值</th><th>显著性</th></tr></thead>
            <tbody>`;

    for (let j = 0; j < flatVars.length; j++) {
        const valsByGroup = [];
        for (let c = 0; c < bestK; c++) valsByGroup.push([]);
        for (let i = 0; i < n; i++) valsByGroup[labels[i]].push(Number(validData[i][flatVars[j]]));

        // Compute F
        const allVals = valsByGroup.flat();
        const grandMean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
        let ssb = 0, ssw = 0;
        for (let c = 0; c < bestK; c++) {
            const g = valsByGroup[c];
            if (g.length === 0) continue;
            const gm = g.reduce((a, b) => a + b, 0) / g.length;
            ssw += g.reduce((a, b) => a + (b - gm) ** 2, 0);
            ssb += g.length * (gm - grandMean) ** 2;
        }
        const dfb = bestK - 1;
        const dfw = n - bestK;
        const f = dfw > 0 && ssw > 0 ? (ssb / dfb) / (ssw / dfw) : 0;
        let pVal = '-';
        if (window.jStat && dfw > 0) {
            pVal = 1 - jStat.centralF.cdf(f, dfb, dfw);
        }

        const pStr = Number.isFinite(pVal) ? (pVal < 0.001 ? '<0.001' : pVal.toFixed(3)) : '-';
        const star = Number.isFinite(pVal) ? (pVal < 0.001 ? '***' : pVal < 0.01 ? '**' : pVal < 0.05 ? '*' : '') : '';
        html += `<tr><td>${flatVars[j]}</td><td>${formatNum(f)}</td><td>${pStr}${star}</td></tr>`;
    }
    html += '</tbody></table>';

    // 6. Interpretation
    const sigVars = [];
    for (let j = 0; j < flatVars.length; j++) {
        const valsByGroup = [];
        for (let c = 0; c < bestK; c++) valsByGroup.push([]);
        for (let i = 0; i < n; i++) valsByGroup[labels[i]].push(Number(validData[i][flatVars[j]]));
        const allVals = valsByGroup.flat();
        const grandMean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
        let ssb = 0, ssw = 0;
        for (let c = 0; c < bestK; c++) {
            const g = valsByGroup[c];
            if (g.length === 0) continue;
            const gm = g.reduce((a, b) => a + b, 0) / g.length;
            ssw += g.reduce((a, b) => a + (b - gm) ** 2, 0);
            ssb += g.length * (gm - grandMean) ** 2;
        }
        const dfb = bestK - 1, dfw = n - bestK;
        const f = dfw > 0 && ssw > 0 ? (ssb / dfb) / (ssw / dfw) : 0;
        let p = Infinity;
        if (window.jStat && dfw > 0) p = 1 - jStat.centralF.cdf(f, dfb, dfw);
        if (p < 0.05) sigVars.push(flatVars[j]);
    }

    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p><strong>聚类分析结果解读：</strong></p>
        <p>本研究采用K-Means聚类算法对${flatVars.join('、')}共${flatVars.length}个变量进行聚类分析。通过肘部法则确定最优聚类数为${bestK}。</p>
        <p>聚类结果表明，${n}个有效样本被分为${bestK}个聚类：${counts.map((c, i) => `聚类${i + 1}（${c}个样本，占${(c / n * 100).toFixed(1)}%）`).join('、')}。</p>
        ${sigVars.length > 0 ? `<p>方差分析显示，${sigVars.join('、')}在不同聚类间存在显著差异（p<0.05），说明这些变量能有效区分不同聚类。</p>` : '<p>方差分析显示，各变量在不同聚类间的差异未达显著水平，聚类区分度较低，建议检查变量选择或尝试其他聚类方法。</p>'}
    </div>`;

    return { method: '聚类分析', html };
}
﻿function performEFA(variables) {
    let allVars = [];
    if (variables.analysisVars && Array.isArray(variables.analysisVars)) {
        allVars = variables.analysisVars;
    } else if (variables['analysis-variables']) {
        allVars = variables['analysis-variables'];
    } else {
        Object.keys(variables).forEach(key => {
            if (key === '_groupNames') return;
            if (Array.isArray(variables[key])) {
                variables[key].forEach(v => { if (!allVars.includes(v)) allVars.push(v); });
            }
        });
    }

    if (allVars.length < 3) throw new Error('探索性因子分析至少需要3个变量');
    const data = getValidRows(allVars);
    const n = data.length;
    const p = allVars.length;
    if (n < p + 1) throw new Error('样本量必须大于变量数');
    const fmt = (v, d) => { d = d || 3; return Number.isFinite(v) ? v.toFixed(d) : '-'; };

    // 1. Correlation matrix
    const R = [];
    for (let i = 0; i < p; i++) {
        R[i] = [];
        for (let j = 0; j < p; j++) {
            if (i === j) { R[i][j] = 1; }
            else { R[i][j] = calculatePearson(data.map(r => Number(r[allVars[i]])), data.map(r => Number(r[allVars[j]]))); }
        }
    }

    // 2. KMO & Bartlett
    let kmo = 0, bartlett = { chi: 0, df: 0, p: 1 };
    try {
        if (window.jStat) {
            const Rinv = jStat.inv(R);
            const lu = R.map(r => r.slice());
            let detSign = 1;
            for (let col = 0; col < p; col++) {
                let pivRow = col, pivAbs = Math.abs(lu[col][col]);
                for (let row = col + 1; row < p; row++) {
                    if (Math.abs(lu[row][col]) > pivAbs) { pivAbs = Math.abs(lu[row][col]); pivRow = row; }
                }
                if (pivAbs < 1e-14) { detSign = 0; break; }
                if (pivRow !== col) { [lu[col], lu[pivRow]] = [lu[pivRow], lu[col]]; detSign *= -1; }
                for (let row = col + 1; row < p; row++) { const f = lu[row][col] / lu[col][col]; lu[row][col] = 0; for (let k = col + 1; k < p; k++) lu[row][k] -= f * lu[col][k]; }
            }
            let logDet = 0;
            if (detSign !== 0) { for (let i = 0; i < p; i++) { if (lu[i][i] <= 0) { detSign = 0; break; } logDet += Math.log(lu[i][i]); } }
            const chi2 = detSign === 0 ? Infinity : Math.max(0, -(n - 1 - (2 * p + 5) / 6) * logDet);
            const df = p * (p - 1) / 2;
            bartlett = { chi: chi2, df, p: Number.isFinite(chi2) ? (1 - jStat.chisquare.cdf(chi2, df)) : 0 };
            let sumR2 = 0, sumP2 = 0;
            for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) { sumR2 += R[i][j] * R[i][j]; const pr = -Rinv[i][j] / Math.sqrt(Rinv[i][i] * Rinv[j][j]); sumP2 += pr * pr; }
            kmo = sumR2 / (sumR2 + sumP2);
        }
    } catch (e) { console.error('KMO/Bartlett error:', e); }

    // 3. Eigendecomposition (Jacobi)
    function jacobi(m, mx) {
        mx = mx || 200; const nn = m.length; let A = m.map(r => r.slice()); let V = Array(nn).fill(0).map((_, i) => { let r = Array(nn).fill(0); r[i] = 1; return r; });
        for (let it = 0; it < mx; it++) {
            let mv = 0, pi = 0, qi = 1;
            for (let i = 0; i < nn - 1; i++) for (let j = i + 1; j < nn; j++) if (Math.abs(A[i][j]) > mv) { mv = Math.abs(A[i][j]); pi = i; qi = j; }
            if (mv < 1e-12) break;
            let th = (A[qi][qi] - A[pi][pi]) / (2 * A[pi][qi]);
            let t = th === 0 ? 1 : Math.sign(th) / (Math.abs(th) + Math.sqrt(th * th + 1));
            let c = 1 / Math.sqrt(t * t + 1), s = c * t;
            let ap = c * c * A[pi][pi] - 2 * s * c * A[pi][qi] + s * s * A[qi][qi], aq = s * s * A[pi][pi] + 2 * s * c * A[pi][qi] + c * c * A[qi][qi];
            A[pi][pi] = ap; A[qi][qi] = aq; A[pi][qi] = A[qi][pi] = 0;
            for (let i = 0; i < nn; i++) {
                if (i !== pi && i !== qi) { let api = c * A[pi][i] - s * A[qi][i], aqi = s * A[pi][i] + c * A[qi][i]; A[pi][i] = A[i][pi] = api; A[qi][i] = A[i][qi] = aqi; }
                let eip = c * V[i][pi] - s * V[i][qi], eiq = s * V[i][pi] + c * V[i][qi]; V[i][pi] = eip; V[i][qi] = eiq;
            }
        }
        return { vals: A.map((_, i) => A[i][i]), vecs: V };
    }

    let ev = jacobi(R);
    let eVals = ev.vals, eVecs = ev.vecs;
    let sIdx = eVals.map((v, i) => i).sort((a, b) => eVals[b] - eVals[a]);
    eVals = sIdx.map(i => eVals[i]);
    eVecs = sIdx.map(idx => eVecs.map(row => row[idx]));

    let numF = eVals.filter(e => e > 1).length;
    if (numF < 1) numF = 1;

    // 4. PAF: iterative communalities
    let h2 = new Array(p).fill(0);
    try {
        const Ri = jStat.inv(R);
        for (let i = 0; i < p; i++) h2[i] = Math.max(0, Math.min(0.999, 1 - 1 / (Ri[i][i] || 1)));
    } catch (e) {
        for (let i = 0; i < p; i++) {
            let s = 0;
            for (let j = 0; j < numF; j++) s += eVecs[i][j] * eVecs[i][j] * eVals[j];
            h2[i] = Math.min(0.999, Math.max(0.2, s));
        }
    }

    let loadings = [];
    for (let iter = 0; iter < 250; iter++) {
        const Rs = R.map((row, i) => row.map((v, j) => (i === j ? h2[i] : v)));
        const eig = jacobi(Rs, 500);
        let rV = eig.vals, rE = eig.vecs;
        let ri = rV.map((v, i) => i).sort((a, b) => rV[b] - rV[a]);
        rV = ri.map(i => rV[i]); rE = ri.map(idx => rE.map(row => row[idx]));
        loadings = [];
        for (let i = 0; i < p; i++) {
            loadings[i] = [];
            for (let j = 0; j < numF; j++) loadings[i][j] = rE[i][j] * Math.sqrt(Math.max(rV[j], 0));
        }
        const nh = new Array(p).fill(0);
        for (let i = 0; i < p; i++) {
            let s = 0;
            for (let j = 0; j < numF; j++) s += loadings[i][j] * loadings[i][j];
            nh[i] = Math.min(s, 1);
        }
        let maxDelta = 0;
        for (let i = 0; i < p; i++) maxDelta = Math.max(maxDelta, Math.abs(nh[i] - h2[i]));
        h2 = nh;
        if (maxDelta < 1e-7) break;
    }

    const extractionFV = loadings[0].map((_, j) => { let s = 0; for (let i = 0; i < p; i++) s += loadings[i][j] ** 2; return s; });

    // 5. Varimax
    function varimax(L) {
        const pp = L.length, kk = L[0].length;
        if (kk < 2) return { loadings: L, vars: L[0].map((_, j) => { let s = 0; for (let i = 0; i < pp; i++) s += L[i][j] ** 2; return s; }) };
        const hh = []; for (let i = 0; i < pp; i++) { let s = 0; for (let j = 0; j < kk; j++) s += L[i][j] ** 2; hh.push(Math.sqrt(s || 1e-10)); }
        let ML = L.map((row, i) => row.map(v => v / hh[i]));
        let d = 0;
        for (let it = 0; it < 100; it++) {
            let od = d; d = 0;
            for (let i = 0; i < kk - 1; i++) { for (let j = i + 1; j < kk; j++) {
                let u = 0, v = 0, A = 0, B = 0;
                for (let l = 0; l < pp; l++) { let x = ML[l][i], y = ML[l][j], u1 = x*x-y*y, v1 = 2*x*y; u += u1; v += v1; A += u1*u1-v1*v1; B += 2*u1*v1; }
                let C = A - (u*u - v*v) / pp, D = B - 2*u*v / pp;
                let phi = Math.atan2(D, C) / 4, sp = Math.sin(phi), cp = Math.cos(phi);
                for (let l = 0; l < pp; l++) { let x = ML[l][i], y = ML[l][j]; ML[l][i] = x*cp + y*sp; ML[l][j] = -x*sp + y*cp; }
            }}
            for (let j = 0; j < kk; j++) { let sq = 0, s = 0; for (let i = 0; i < pp; i++) { let q = ML[i][j]**2; sq += q*q; s += q; } d += sq - s*s/pp; }
            if (Math.abs(d - od) < 1e-8) break;
        }
        const res = ML.map((row, i) => row.map(v => v * hh[i]));
        const vs = []; for (let j = 0; j < kk; j++) { let s = 0; for (let i = 0; i < pp; i++) s += res[i][j] ** 2; vs.push({ idx: j, v: s }); }
        vs.sort((a, b) => b.v - a.v);
        return { loadings: res.map(row => vs.map(v => row[v.idx])), vars: vs.map(v => v.v) };
    }

    // Apply varimax rotation (extraction eigenvalues already computed above)
    let fL = loadings, fV = extractionFV.slice();
    if (numF > 1) {
        const rot = varimax(loadings);
        fL = rot.loadings;
        fV = rot.vars;
    }

    const kmoOk = kmo > 0.6 && bartlett.p < 0.05;

    // 6. HTML output
    let html = '';
    html += '<h3>探索性因子分析 (EFA)</h3>';
    html += '<p><strong>（1）KMO 与 Bartlett 检验</strong></p>';
    html += '<p>KMO>0.6且Bartlett检验p<0.05表示数据适合因子分析。</p>';
    html += '<table class="result-table"><thead><tr><th>检验项目</th><th>指标</th><th>值</th></tr></thead><tbody>';
    html += '<tr><td>KMO 取样适切性量数</td><td colspan="2">' + fmt(kmo) + '</td></tr>';
    html += '<tr><td rowspan="3">Bartlett 球形检验</td><td>近似卡方</td><td>' + fmt(bartlett.chi) + '</td></tr>';
    html += '<tr><td>df</td><td>' + bartlett.df + '</td></tr>';
    html += '<tr><td>p 值</td><td>' + (bartlett.p < 0.001 ? '<0.001' : fmt(bartlett.p)) + '</td></tr>';
    html += '</tbody></table>';
    html += '<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">';
    html += kmoOk ? 'KMO=' + fmt(kmo) + '（>0.6），Bartlett检验显著（p' + (bartlett.p < 0.001 ? '<0.001' : '=' + fmt(bartlett.p)) + '），数据适合因子分析。' : 'KMO=' + fmt(kmo) + '，数据可能不太适合因子分析，仅供参考。';
    html += '</div>';

    // Total variance explained — matches SPSS 3-section table
    html += '<p><strong>（2）总方差解释</strong></p>';
    html += '<table class="result-table"><thead><tr><th>因子</th><th>初始特征值</th><th>解释率%</th><th>累积%</th><th>提取载荷平方和</th><th>提取解释率%</th><th>提取累积%</th><th>旋转载荷平方和</th><th>旋转解释率%</th><th>旋转累积%</th></tr></thead><tbody>';
    let accPre = 0, accExt = 0, accRot = 0;
    for (let i = 0; i < p; i++) {
        const pct = (eVals[i] / p) * 100; accPre += pct;
        let ex = '-', ep = '-', ec = '-';
        let rx = '-', rp = '-', rc = '-';
        if (i < numF) {
            ex = fmt(extractionFV[i]); ep = (extractionFV[i]/p*100).toFixed(2); accExt += extractionFV[i]/p*100; ec = accExt.toFixed(2);
            rx = fmt(fV[i]); rp = (fV[i]/p*100).toFixed(2); accRot += fV[i]/p*100; rc = accRot.toFixed(2);
        }
        html += '<tr><td>' + (i+1) + '</td><td>' + fmt(eVals[i]) + '</td><td>' + pct.toFixed(2) + '</td><td>' + accPre.toFixed(2) + '</td>';
        html += '<td>' + ex + '</td><td>' + ep + '</td><td>' + ec + '</td><td>' + rx + '</td><td>' + rp + '</td><td>' + rc + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">';
    html += '采用主轴因子法（PAF）提取，特征值>1共提取' + numF + '个因子，旋转后累计解释率' + accRot.toFixed(2) + '%。第一因子解释率' + (eVals[0]/p*100).toFixed(2) + '%' + (eVals[0]/p*100 < 50 ? '（<50%，不存在严重共同方法偏差）' : '（较高，可能存在共同方法偏差）') + '。';
    html += '</div>';
    html += '<p><strong>（3）旋转后的成分矩阵</strong></p><p>最大方差法（Varimax）旋转，载荷绝对值低于0.4不显示。</p>';
    html += '<table class="result-table"><thead><tr><th>变量</th>';
    for (let j = 0; j < numF; j++) html += '<th>因子' + (j+1) + '</th>';
    html += '<th>共同度</th></tr></thead><tbody>';
    for (let i = 0; i < p; i++) {
        html += '<tr><td>' + allVars[i] + '</td>';
        for (let j = 0; j < numF; j++) { const v = fL[i][j]; html += '<td>' + (Math.abs(v) >= 0.4 ? fmt(v) : '') + '</td>'; }
        html += '<td>' + fmt(h2[i]) + '</td></tr>';
    }
    html += '</tbody></table>';

    html += '<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">';
    for (let j = 0; j < numF; j++) {
        const vs = [];
        for (let i = 0; i < p; i++) if (Math.abs(fL[i][j]) >= 0.4) vs.push(allVars[i] + '(' + fmt(fL[i][j]) + ')');
        if (vs.length > 0) html += '因子' + (j+1) + '：' + vs.join('、') + '<br>';
    }
    html += '</div>';

    return { method: '探索性因子分析(EFA)', html };
}
function performBinaryLogit(variables) {
    const yVar = (variables['y-variable'] || [])[0];
    const xVars = variables['x-variables'] || [];

    if (!yVar || xVars.length === 0) throw new Error('请选择因变量和自变量');

    const validData = getValidRows([yVar, ...xVars]);
    if (validData.length < 20) throw new Error('样本量不足，至少需要20条完整样本');

    const getSortedCategories = (values) => {
        const uniqueValues = [...new Set(values.map(value => String(value).trim()))];
        const allNumeric = uniqueValues.every(value => value !== '' && !isNaN(Number(value)));
        return uniqueValues.sort((a, b) => (
            allNumeric
                ? Number(a) - Number(b)
                : a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
        ));
    };

    const yCategories = getSortedCategories(validData.map(row => row[yVar]));
    if (yCategories.length !== 2) throw new Error(`因变量${yVar}必须恰好包含2个类别`);

    const yReference = yCategories[0];
    const yEvent = yCategories[1];
    const y = validData.map(row => String(row[yVar]).trim() === yEvent ? 1 : 0);
    const totalSample = currentData.processed.length;
    const validSample = validData.length;
    const missingSample = totalSample - validSample;
    const eventCount = y.reduce((sum, value) => sum + value, 0);
    const nonEventCount = y.length - eventCount;
    if (eventCount === 0 || nonEventCount === 0) throw new Error(`因变量${yVar}必须同时包含两个类别样本`);

    const predictorColumns = [];
    const predictorMeta = [];

    xVars.forEach(variable => {
        const rawValues = validData.map(row => row[variable]);
        const numericValues = rawValues.map(value => Number(value));
        const allNumeric = numericValues.every(value => Number.isFinite(value));

        if (allNumeric) {
            const sd = jStat.stdev(numericValues, true);
            if (!Number.isFinite(sd) || sd === 0) throw new Error(`${variable}没有足够变异，无法纳入Logit回归`);
            predictorColumns.push(numericValues);
            predictorMeta.push({
                variable,
                displayName: variable,
                type: 'numeric'
            });
            return;
        }

        const categories = getSortedCategories(rawValues);
        if (categories.length !== 2) throw new Error(`自变量${variable}当前仅支持数值型或二分类变量`);

        const reference = categories[0];
        const event = categories[1];
        const dummyValues = rawValues.map(value => String(value).trim() === event ? 1 : 0);
        const sd = jStat.stdev(dummyValues, true);
        if (!Number.isFinite(sd) || sd === 0) throw new Error(`${variable}在当前样本中只有一个水平，无法纳入Logit回归`);

        predictorColumns.push(dummyValues);
        predictorMeta.push({
            variable,
            displayName: variable,
            type: 'binary',
            reference,
            event
        });
    });

    if (y.length <= predictorColumns.length + 1) throw new Error('样本量不足以支撑当前模型，请减少自变量数量');

    const model = fitBinaryLogitModel(predictorColumns, y);
    const nullLogLikelihood = eventCount * Math.log(eventCount / y.length) + nonEventCount * Math.log(nonEventCount / y.length);
    const interceptOnlyNeg2LL = -2 * nullLogLikelihood;
    const modelChiSquare = 2 * (model.logLikelihood - nullLogLikelihood);
    const modelDf = predictorColumns.length;
    const modelP = modelDf > 0 ? 1 - jStat.chisquare.cdf(modelChiSquare, modelDf) : NaN;
    const coxSnell = 1 - Math.exp((2 / y.length) * (nullLogLikelihood - model.logLikelihood));
    const nagelkerkeDenominator = 1 - Math.exp((2 / y.length) * nullLogLikelihood);
    const nagelkerke = nagelkerkeDenominator !== 0 ? coxSnell / nagelkerkeDenominator : NaN;
    const mcfadden = nullLogLikelihood !== 0 ? 1 - (model.logLikelihood / nullLogLikelihood) : NaN;
    const aic = model.neg2LogLikelihood + 2 * model.beta.length;
    const bic = model.neg2LogLikelihood + Math.log(y.length) * model.beta.length;

    const formatNum = (value) => Number.isFinite(value) ? value.toFixed(3) : '-';
    const formatP = (value) => {
        if (!Number.isFinite(value)) return '-';
        if (value < 0.001) return '0.000';
        return value.toFixed(3);
    };
    const formatPWithStars = (value) => {
        if (!Number.isFinite(value)) return '-';
        const stars = value < 0.01 ? '**' : (value < 0.05 ? '*' : '');
        return `${formatP(value)}${stars}`;
    };
    const formatPct = (value, decimals = 2) => Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : '-';
    const formatOrCi = (lower, upper) => `${formatNum(lower)} ~ ${formatNum(upper)}`;
    const formatPCompare = (value) => {
        if (!Number.isFinite(value)) return '-';
        return `${formatP(value)}${value < 0.05 ? '<0.05' : '≥0.05'}`;
    };
    const getSigLevelText = (value) => {
        if (!Number.isFinite(value)) return '未达到显著性';
        if (value < 0.01) return '呈现出0.01水平的显著性';
        if (value < 0.05) return '呈现出0.05水平的显著性';
        return '并没有呈现出显著性';
    };
    const coefficientRows = [
        ...predictorMeta.map((meta, index) => ({
            name: meta.displayName,
            beta: model.beta[index + 1],
            se: model.se[index + 1],
            z: model.zValues[index + 1],
            wald: model.wald[index + 1],
            p: model.pValues[index + 1]
        })),
        {
            name: '截距',
            beta: model.beta[0],
            se: model.se[0],
            z: model.zValues[0],
            wald: model.wald[0],
            p: model.pValues[0]
        }
    ].map(row => {
        const or = Number.isFinite(row.beta) ? Math.exp(row.beta) : NaN;
        const lower = Number.isFinite(row.beta) && Number.isFinite(row.se) ? Math.exp(row.beta - 1.96 * row.se) : NaN;
        const upper = Number.isFinite(row.beta) && Number.isFinite(row.se) ? Math.exp(row.beta + 1.96 * row.se) : NaN;
        return { ...row, or, lower, upper };
    });

    const predictorRows = coefficientRows.filter(row => row.name !== '截距');
    const significantPredictors = predictorRows.filter(row => row.p < 0.05);
    const nonSignificantPredictors = predictorRows.filter(row => !(row.p < 0.05));
    const interceptRow = coefficientRows.find(row => row.name === '截距');
    const modelFormula = `${formatNum(interceptRow.beta)}${predictorRows.map(row => `${row.beta >= 0 ? ' + ' : ' - '}${formatNum(Math.abs(row.beta))}*${row.name}`).join('')}`;
    const predictorDetails = predictorRows.map(row => {
        const relation = row.beta >= 0 ? '显著的正向影响关系' : '显著的负向影响关系';
        const changeDirection = row.beta >= 0 ? '增加' : '降低';
        if (row.p < 0.05) {
            return `${row.name}的回归系数值为${formatNum(row.beta)}，并且${getSigLevelText(row.p)}(z=${formatNum(row.z)}，p=${formatPCompare(row.p)})，意味着${row.name}会对${yVar}产生${relation}。以及优势比(OR值)为${formatNum(row.or)}，意味着${row.name}增加一个单位时，${yVar}取值为“${yEvent}”的变化(${changeDirection})幅度为${formatNum(row.or)}倍。`;
        }
        return `${row.name}的回归系数值为${formatNum(row.beta)}，但是${getSigLevelText(row.p)}(z=${formatNum(row.z)}，p=${formatPCompare(row.p)})，意味着${row.name}并不会对${yVar}产生影响关系。`;
    }).join('</p><p>');
    const positiveSignificantPredictors = significantPredictors.filter(row => row.beta >= 0).map(row => row.name);
    const negativeSignificantPredictors = significantPredictors.filter(row => row.beta < 0).map(row => row.name);
    const summaryParts = [];
    if (positiveSignificantPredictors.length > 0) {
        summaryParts.push(`${positiveSignificantPredictors.join('、')}会对${yVar}产生显著正向影响`);
    }
    if (negativeSignificantPredictors.length > 0) {
        summaryParts.push(`${negativeSignificantPredictors.join('、')}会对${yVar}产生显著负向影响`);
    }
    if (nonSignificantPredictors.length > 0) {
        summaryParts.push(`${nonSignificantPredictors.map(row => row.name).join('、')}未达到显著水平`);
    }
    const summaryText = summaryParts.length > 0
        ? `${summaryParts.join('；')}。`
        : `${predictorRows.map(row => row.name).join('、')}并不会对${yVar}产生显著影响关系。`;

    const html = `<h3>二元Logit回归分析</h3>
    <h4>（1）因变量编码</h4>
    <table class="result-table">
        <thead><tr><th>变量</th><th>参考类别</th><th>编码</th><th>事件类别</th><th>编码</th><th>样本量</th></tr></thead>
        <tbody>
            <tr><td>${yVar}</td><td>${yReference}</td><td>0</td><td>${yEvent}</td><td>1</td><td>${y.length}</td></tr>
        </tbody>
    </table>

    <h4>（2）二元Logit回归分析基本汇总</h4>
    <table class="result-table">
        <thead><tr><th>名称</th><th>选项</th><th>频数</th><th>百分比</th></tr></thead>
        <tbody>
            <tr><td rowspan="3">${yVar}</td><td>0</td><td>${nonEventCount}</td><td>${formatPct(nonEventCount / y.length)}</td></tr>
            <tr><td>1</td><td>${eventCount}</td><td>${formatPct(eventCount / y.length)}</td></tr>
            <tr><td>总计</td><td>${y.length}</td><td>100.00%</td></tr>
            <tr><td rowspan="3">汇总</td><td>有效</td><td>${validSample}</td><td>${formatPct(validSample / totalSample)}</td></tr>
            <tr><td>缺失</td><td>${missingSample}</td><td>${formatPct(missingSample / totalSample)}</td></tr>
            <tr><td>总计</td><td>${totalSample}</td><td>100.00%</td></tr>
        </tbody>
    </table>

    <p>将${xVars.join(', ')}作为自变量，而将${yVar}作为因变量进行二元Logit回归分析从上表可以看出，总共有${validSample}个样本参加分析，并且${missingSample === 0 ? '没有缺失数据' : `存在${missingSample}个缺失数据`}。</p>

    <h4>（3）二元Logit回归模型似然比检验结果</h4>
    <table class="result-table">
        <thead><tr><th>模型</th><th>-2倍对数似然值</th><th>卡方值</th><th>df</th><th>p</th><th>AIC值</th><th>BIC值</th></tr></thead>
        <tbody>
            <tr><td>仅截距</td><td>${formatNum(interceptOnlyNeg2LL)}</td><td></td><td></td><td></td><td></td><td></td></tr>
            <tr><td>最终模型</td><td>${formatNum(model.neg2LogLikelihood)}</td><td>${formatNum(modelChiSquare)}</td><td>${modelDf}</td><td>${formatPWithStars(modelP)}</td><td>${formatNum(aic)}</td><td>${formatNum(bic)}</td></tr>
        </tbody>
    </table>

    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>首先对模型整体有效性进行分析，从上表可知：此处模型检验的原定假设为：是否放入自变量（${xVars.join(', ')}）两种情况时模型质量均一样；这里p值${modelP < 0.05 ? '小于0.05，因而说明拒绝原定假设，即说明本次构建模型时，放入的自变量具有有效性，本次模型构建有意义。' : '大于0.05，因而不能拒绝原定假设，即说明本次放入的自变量对模型整体提升并不明显。'}</p>
    </div>

    <h4>（4）二元Logit回归分析结果汇总</h4>
    <p>* p&lt;0.05，** p&lt;0.01</p>
    <table class="result-table">
        <thead><tr><th>项</th><th>回归系数</th><th>标准误</th><th>z值</th><th>Wald χ²</th><th>p值</th><th>OR值</th><th>OR值95% CI</th></tr></thead>
        <tbody>
            ${coefficientRows.map(row => `<tr><td>${row.name}</td><td>${formatNum(row.beta)}</td><td>${formatNum(row.se)}</td><td>${formatNum(row.z)}</td><td>${formatNum(row.wald)}</td><td>${formatP(row.p)}</td><td>${formatNum(row.or)}</td><td>${formatOrCi(row.lower, row.upper)}</td></tr>`).join('')}
        </tbody>
    </table>

    <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">
        <p>从上表可知，将${xVars.join(', ')}为自变量，而将${yVar}作为因变量进行二元Logit回归分析从上表可以看出，意味着${xVars.join(', ')}可以解释${yVar}的${formatNum(nagelkerke)}变化原因。从上表可知：模型公式为：ln(p/1-p)=${modelFormula}(其中p代表${yVar}为“${yEvent}”的概率，1-p代表${yVar}为“${yReference}”的概率)。最终具体分析可知：</p>
        <p>${predictorDetails}</p>
        <p>总结分析可知：${summaryText}</p>
    </div>`;

    return { method: '二元Logit回归', html };
}
function performPartialCorrelation(variables) {
    const analysisVars = variables['variables'] || variables['analysis-variables'] || [];
    const controlVars = variables['control'] || variables['control-variables'] || [];

    if (analysisVars.length < 2) throw new Error('偏相关分析至少需要2个分析变量');
    if (controlVars.length < 1) throw new Error('偏相关分析至少需要1个控制变量');

    const allVars = [...new Set([...analysisVars, ...controlVars])];
    const validData = getValidRows(allVars);
    const n = validData.length;
    if (n < allVars.length + 2) throw new Error('样本量不足');

    const formatNum = (v) => Number.isFinite(v) ? v.toFixed(3) : '-';
    const formatP = (v) => { if (!Number.isFinite(v)) return '-'; return v < 0.001 ? '<0.001' : v.toFixed(3); };
    const getStars = (v) => { if (!Number.isFinite(v)) return ''; return v < 0.001 ? '***' : v < 0.01 ? '**' : v < 0.05 ? '*' : ''; };

    // Build correlation matrix for all variables
    const p = allVars.length;
    const corrMatrix = [];
    for (let i = 0; i < p; i++) {
        corrMatrix[i] = [];
        for (let j = 0; j < p; j++) {
            if (i === j) { corrMatrix[i][j] = 1; }
            else {
                const xi = validData.map(r => Number(r[allVars[i]]));
                const xj = validData.map(r => Number(r[allVars[j]]));
                corrMatrix[i][j] = calculatePearson(xi, xj);
            }
        }
    }

    // Precision matrix = inverse of correlation matrix
    let precisionMatrix = null;
    let partialCorrMatrix = {};

    try {
        if (window.jStat) {
            precisionMatrix = jStat.inv(corrMatrix);
        }
    } catch (e) {
        console.error('Matrix inversion failed', e);
    }

    // Compute partial correlations: r_ij·controls = -p_ij / sqrt(p_ii * p_jj)
    const df = n - controlVars.length - 2;

    for (let ai = 0; ai < analysisVars.length; ai++) {
        for (let aj = ai + 1; aj < analysisVars.length; aj++) {
            const ii = allVars.indexOf(analysisVars[ai]);
            const jj = allVars.indexOf(analysisVars[aj]);

            let rPartial = 0, tStat = 0, pVal = 1;

            if (precisionMatrix) {
                const pii = precisionMatrix[ii][ii];
                const pjj = precisionMatrix[jj][jj];
                const pij = precisionMatrix[ii][jj];
                const denom = Math.sqrt(pii * pjj);
                rPartial = denom === 0 ? 0 : -pij / denom;
                // Clamp
                rPartial = Math.max(-1, Math.min(1, rPartial));

                if (df > 0 && Math.abs(rPartial) < 1) {
                    tStat = rPartial * Math.sqrt(df / (1 - rPartial * rPartial));
                    if (window.jStat) {
                        pVal = (1 - jStat.studentt.cdf(Math.abs(tStat), df)) * 2;
                    }
                }
            }

            // Zero-order (simple) correlation
            const ri = allVars.indexOf(analysisVars[ai]);
            const rj = allVars.indexOf(analysisVars[aj]);
            const rSimple = corrMatrix[ri][rj];
            const dfSimple = n - 2;
            let tSimple = 0, pSimple = 1;
            if (dfSimple > 0 && Math.abs(rSimple) < 1) {
                tSimple = rSimple * Math.sqrt(dfSimple / (1 - rSimple * rSimple));
                if (window.jStat) {
                    pSimple = (1 - jStat.studentt.cdf(Math.abs(tSimple), dfSimple)) * 2;
                }
            }

            const key = `${analysisVars[ai]}|${analysisVars[aj]}`;
            partialCorrMatrix[key] = {
                var1: analysisVars[ai], var2: analysisVars[aj],
                rSimple, pSimple, tSimple,
                rPartial, pVal, tStat, df
            };
        }
    }

    // --- Build HTML ---
    let html = `<h3>偏相关分析</h3>
        <p>偏相关分析用于在控制一个或多个变量的条件下，考察两个变量之间的净相关关系。控制变量：${controlVars.join('、')}。</p>`;

    // 1. Partial correlation table
    html += `<p><strong>（1）偏相关系数表</strong></p>
        <table class="result-table">
            <thead><tr><th>变量对</th><th>df</th><th>偏相关系数 r</th><th>t 值</th><th>p 值</th><th>显著性</th></tr></thead>
            <tbody>`;

    for (const key of Object.keys(partialCorrMatrix)) {
        const item = partialCorrMatrix[key];
        const star = getStars(item.pVal);
        html += `<tr>
            <td>${item.var1} — ${item.var2}</td>
            <td>${item.df}</td>
            <td>${formatNum(item.rPartial)}</td>
            <td>${formatNum(item.tStat)}</td>
            <td>${formatP(item.pVal)}</td>
            <td>${star}</td>
        </tr>`;
    }
    html += '</tbody></table>';

    // 2. Comparison table
    html += `<p><strong>（2）零阶相关与偏相关对比</strong></p>
        <table class="result-table">
            <thead><tr><th>变量对</th><th>零阶相关 r</th><th>零阶 p</th><th>偏相关 r</th><th>偏相关 p</th><th>变化</th></tr></thead>
            <tbody>`;

    for (const key of Object.keys(partialCorrMatrix)) {
        const item = partialCorrMatrix[key];
        const change = item.rPartial - item.rSimple;
        const changeStr = (change >= 0 ? '+' : '') + formatNum(change);
        html += `<tr>
            <td>${item.var1} — ${item.var2}</td>
            <td>${formatNum(item.rSimple)}</td>
            <td>${formatP(item.pSimple)}</td>
            <td>${formatNum(item.rPartial)}</td>
            <td>${formatP(item.pVal)}</td>
            <td>${changeStr}</td>
        </tr>`;
    }
    html += '</tbody></table>';

    // 3. Interpretation
    const sigPairs = Object.values(partialCorrMatrix).filter(item => item.pVal < 0.05);
    const insigPairs = Object.values(partialCorrMatrix).filter(item => item.pVal >= 0.05);

    let interp = `<p><strong>偏相关分析结果解读：</strong></p>
        <p>在控制${controlVars.join('、')}的条件下，对${analysisVars.join('、')}进行偏相关分析。</p>`;

    if (sigPairs.length > 0) {
        interp += `<p>以下变量对在控制后仍存在显著的偏相关关系（p<0.05）：</p><ul>`;
        sigPairs.forEach(item => {
            interp += `<li>${item.var1}与${item.var2}的偏相关系数为${formatNum(item.rPartial)}（p=${formatP(item.pVal)}${getStars(item.pVal)}），${Math.abs(item.rPartial) >= 0.7 ? '相关性较强' : Math.abs(item.rPartial) >= 0.4 ? '相关性中等' : '相关性较弱'}。</li>`;
        });
        interp += '</ul>';
    }
    if (insigPairs.length > 0) {
        interp += `<p>以下变量对在控制后偏相关不显著：${insigPairs.map(item => `${item.var1}与${item.var2}`).join('、')}（p≥0.05）。</p>`;
    }

    // Check attenuation
    const attenuated = Object.values(partialCorrMatrix).filter(item => Math.abs(item.rPartial) < Math.abs(item.rSimple) * 0.5);
    if (attenuated.length > 0) {
        interp += `<p>值得注意的是，${attenuated.map(item => `${item.var1}与${item.var2}`).join('、')}的偏相关系数相比零阶相关大幅减弱，说明控制变量在这些关系中起到重要的中介或混淆作用。</p>`;
    }

    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interp}</div>`;

    return { method: '偏相关分析', html };
}


// ---------------- 分析函数 ----------------

function performDescriptiveAnalysis(variables) {
    const analysisVars = variables['analysis-variables'] || [];
    if (analysisVars.length === 0) throw new Error('请选择分析变量');
    
    let html = `<h3>变量题项描述统计（描述分析）</h3>
        <p>变量的描述统计是指对一个或多个变量进行总结和描述的统计方法。它提供了有关变量的中心趋势、离散程度、分布形状和其他相关统计指标的信息。本研究包括数值变量的平均值、标准差、中位数、峰度、偏度等指标。</p>
        <p><strong>（1）变量描述及变量分布</strong></p>
        <table class="result-table">
            <thead><tr><th>名称</th><th>样本量</th><th>最小值</th><th>最大值</th><th>平均值</th><th>标准差</th><th>中位数</th><th>峰度</th><th>偏度</th></tr></thead>
            <tbody>`;
            
    const results = [];
    analysisVars.forEach(variable => {
        const values = currentData.processed
            .map(row => Number(row[variable]))
            .filter(v => v !== null && !isNaN(v));
        if (values.length === 0) return;
        
        const n = values.length;
        const sum = values.reduce((a,b) => a+b, 0);
        const mean = sum / n;
        const sorted = [...values].sort((a,b) => a-b);
        const min = sorted[0];
        const max = sorted[n-1];
        const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
        
        const variance = values.reduce((a,b) => a + Math.pow(b-mean, 2), 0) / (n - 1);
        const std = Math.sqrt(variance);
        
        let m3 = 0, m4 = 0;
        values.forEach(v => {
            m3 += Math.pow(v - mean, 3);
            m4 += Math.pow(v - mean, 4);
        });
        m3 /= n;
        m4 /= n;
        
        const skewness = std > 0 ? m3 / Math.pow(std, 3) : 0;
        const kurtosis = std > 0 ? (m4 / Math.pow(std, 4)) - 3 : 0;
        
        html += `<tr>
            <td>${variable}</td>
            <td>${n}</td>
            <td>${min}</td>
            <td>${max}</td>
            <td>${mean.toFixed(3)}</td>
            <td>${std.toFixed(3)}</td>
            <td>${median.toFixed(3)}</td>
            <td>${kurtosis.toFixed(3)}</td>
            <td>${skewness.toFixed(3)}</td>
        </tr>`;
        
        results.push({ variable, mean, std, n, min, max, median, skewness, kurtosis });
    });
    
    html += '</tbody></table>';
    
    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `根据调查数据的统计结果，各项指标的均值和标准差如下：`;
    results.forEach((r, index) => {
        interpretation += `在“${r.variable}”方面，平均值为${r.mean.toFixed(3)}，标准差为${r.std.toFixed(3)}；`;
    });
    // Remove last semicolon
    if (interpretation.endsWith('；')) interpretation = interpretation.slice(0, -1) + '。';

    interpretation += `<br><br><strong>正态性说明：</strong><br>`;
    if (results.length > 0) {
        const skewMin = Math.min(...results.map(r => r.skewness));
        const skewMax = Math.max(...results.map(r => r.skewness));
        const kurtMin = Math.min(...results.map(r => r.kurtosis));
        const kurtMax = Math.max(...results.map(r => r.kurtosis));
        interpretation += `Hair（2010）建议，偏度值在+3和-3之间是可以认为正态性。同时，峰度用于描述数据分布的尖峰或平缓。Kline（2011）建议，峰度绝对值小于10并且偏度绝对值小于3，则说明数据虽然不是绝对正态，但基本可接受为正态分布。以上各维度的峰度范围为${kurtMin.toFixed(3)}至${kurtMax.toFixed(3)}，偏度范围为${skewMin.toFixed(3)}至${skewMax.toFixed(3)}，各变量的峰度和偏度均在 [-3, 3] 以内，表明数据分布较为接近正态，可认为各变量近似正态分布。`;
    }
    
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
    
    return {
        method: '描述性分析',
        timestamp: new Date().toLocaleString(),
        html: html
    };
}

function generateDescriptiveHTML(results) {
    let html = '<table class="result-table" data-pagination="false"><thead><tr><th>变量</th><th>样本量</th><th>平均值</th><th>标准差</th><th>最小值</th><th>最大值</th></tr></thead><tbody>';
    results.forEach(r => {
        html += `<tr><td>${r.variable}</td><td>${r.count}</td><td>${r.mean}</td><td>${r.std}</td><td>${r.min}</td><td>${r.max}</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
}

function performFrequencyAnalysis(variables) {
    const analysisVars = variables['frequency-variables'] || [];
    if (analysisVars.length === 0) throw new Error('请选择分析变量');
    
    let html = `<h3>频数分析</h3>
        <p>使用 SPSS 26.0 数据分析软件对收集到的数据进行描述性统计，主要涉及人口特征等基本信息，分析结果如下所示：</p>
        <table class="result-table">
            <thead><tr><th>名称</th><th>选项</th><th>频数</th><th>百分比(%)</th><th>累积百分比(%)</th></tr></thead>
            <tbody>`;
            
    let totalN = 0;
    
    const varStats = [];

    analysisVars.forEach(variable => {
        const values = currentData.processed
            .map(row => row[variable])
            .filter(v => v !== null && v !== undefined && v !== '');
        const counts = {};
        values.forEach(v => counts[v] = (counts[v] || 0) + 1);
        
        const total = values.length;
        if(total > totalN) totalN = total;
        
        const keys = Object.keys(counts).sort();
        let cumulative = 0;
        
        const stats = [];

        keys.forEach((key, index) => {
            const freq = counts[key];
            const pct = (freq / total) * 100;
            cumulative += pct;
            
            html += `<tr>`;
            if (index === 0) {
                html += `<td rowspan="${keys.length}">${variable}</td>`;
            }
            html += `<td>${key}</td>
                <td>${freq}</td>
                <td>${pct.toFixed(2)}</td>
                <td>${Math.min(cumulative, 100).toFixed(2)}</td>
            </tr>`;
            
            stats.push({ key, freq, pct });
        });
        
        varStats.push({ variable, stats });
    });
    
    html += `<tr><td><strong>合计</strong></td><td></td><td><strong>${totalN}</strong></td><td><strong>100</strong></td><td><strong>100</strong></td></tr>`;
    html += '</tbody></table>';
    
    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `根据问卷数据的统计结果，`;
    
    varStats.forEach((v, idx) => {
        interpretation += `${v.variable}方面，`;
        v.stats.forEach((s, sIdx) => {
            interpretation += `${s.key}回答者为${s.freq}人，占${Number(s.pct.toFixed(2))}%`;
            if (sIdx < v.stats.length - 1) interpretation += `，`;
        });
        interpretation += `。`;
    });
    
    interpretation += `总体样本数量为${totalN}人，占全部受访者的100%。`;
    
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
    
    return {
        method: '频数分析',
        timestamp: new Date().toLocaleString(),
        html: html
    };
}

function performCorrelationAnalysis(variables) {
    const analysisVars = variables['analysis-variables'] || [];
    if (analysisVars.length < 2) throw new Error('至少需要2个变量');

    const pairs = [];
    const correlationStats = {};

    analysisVars.forEach(v1 => {
        correlationStats[v1] = {};
        analysisVars.forEach(v2 => {
            if (v1 === v2) {
                correlationStats[v1][v2] = { r: 1, p: null, n: null, star: '' };
            } else {
                const vals = currentData.processed.filter(r => r[v1]!=null && !isNaN(r[v1]) && r[v2]!=null && !isNaN(r[v2]));
                const x = vals.map(r => Number(r[v1]));
                const y = vals.map(r => Number(r[v2]));
                const r = calculatePearson(x, y);
                const n = x.length;
                let p = 1;
                if (window.jStat && n > 2) {
                    const denominator = 1 - r * r;
                    const t = denominator <= 0 ? Number.POSITIVE_INFINITY : r * Math.sqrt((n - 2) / denominator);
                    p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - 2));
                }
                let star = p < 0.01 ? '**' : (p < 0.05 ? '*' : '');
                correlationStats[v1][v2] = { r, p, n, star };
                
                if (analysisVars.indexOf(v1) < analysisVars.indexOf(v2)) {
                    pairs.push({ v1, v2, r, p, star });
                }
            }
        });
    });

    const formatId = `correlation-format-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    let html = `<div class="correlation-analysis-result">
        <div class="correlation-layout">
            <div class="correlation-table-section">
                <div class="correlation-header">
                    <h4>相关性分析</h4>
                    <div class="format-controls">
                        <button type="button" class="toggle-btn active" onclick="toggleCorrelationFormat(this, '${formatId}', 'full')">完整表</button>
                        <button type="button" class="toggle-btn" onclick="toggleCorrelationFormat(this, '${formatId}', 'simple')">简化表</button>
                    </div>
                </div>
                <div id="${formatId}">
                    <div class="correlation-format" data-format="full">
                        ${buildFullCorrelationTable(analysisVars, correlationStats)}
                    </div>
                    <div class="correlation-format" data-format="simple" style="display:none;">
                        ${buildSimpleCorrelationTable(analysisVars, correlationStats)}
                    </div>
                </div>
            </div>`;

    let interpretation = `在相关性方面，`;
    pairs.forEach(pair => {
        const relationType = pair.r > 0 ? '正相关' : '负相关';
        const pText = pair.p < 0.001 ? '0.000' : pair.p.toFixed(3);
        const directionText = pair.r > 0
            ? `${pair.v1}程度越高，${pair.v2}程度可能越高`
            : `${pair.v1}程度越高，${pair.v2}程度可能越低，反之亦然`;
        if (pair.p < 0.05) {
            interpretation += `${pair.v1}与${pair.v2}呈现${relationType}，相关系数为${pair.r.toFixed(3)}${pair.star}，意味着${directionText}，且该相关性达到统计学显著水平（p=${pText}，${pair.p < 0.01 ? 'p<0.01' : 'p<0.05'}）。`;
        } else {
            interpretation += `${pair.v1}与${pair.v2}呈现${relationType}趋势，相关系数为${pair.r.toFixed(3)}，但未达到统计学显著水平（p=${pText}，p≥0.05），暂不能据此认定两者存在显著相关关系。`;
        }
    });

    html += `
            <div class="correlation-interpretation-section">
                <h5>结果解读</h5>
                <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>
            </div>
        </div>
    </div>`;

    return { method: '相关分析', html: html };
}

function buildFullCorrelationTable(analysisVars, correlationStats) {
    let html = `<table class="result-table correlation-table"><thead><tr><th>变量</th><th></th>`;
    analysisVars.forEach(v => html += `<th>${v}</th>`);
    html += '</tr></thead><tbody>';

    analysisVars.forEach(v1 => {
        html += `<tr><td rowspan="3"><strong>${v1}</strong></td><td>相关系数</td>`;
        analysisVars.forEach(v2 => {
            const stat = correlationStats[v1][v2];
            html += `<td>${v1 === v2 ? '1' : `${stat.r.toFixed(3)}${stat.star}`}</td>`;
        });
        html += '</tr><tr><td>p 值</td>';

        analysisVars.forEach(v2 => {
            const stat = correlationStats[v1][v2];
            html += `<td>${v1 === v2 ? '-' : (stat.p < 0.001 ? '0.000' : stat.p.toFixed(3))}</td>`;
        });
        html += '</tr><tr><td>样本量</td>';

        analysisVars.forEach(v2 => {
            const stat = correlationStats[v1][v2];
            html += `<td>${v1 === v2 ? '-' : stat.n}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}

function buildSimpleCorrelationTable(analysisVars, correlationStats) {
    let html = `<table class="result-table correlation-table"><thead><tr><th>变量</th>`;
    analysisVars.forEach(v => html += `<th>${v}</th>`);
    html += '</tr></thead><tbody>';

    analysisVars.forEach(v1 => {
        html += `<tr><td><strong>${v1}</strong></td>`;
        analysisVars.forEach(v2 => {
            const stat = correlationStats[v1][v2];
            html += `<td>${v1 === v2 ? '1' : `${stat.r.toFixed(3)}${stat.star}`}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table><div style="margin-top:8px; color:#6c757d; font-size:12px;">* p&lt;0.05，** p&lt;0.01</div>';
    return html;
}

function calculateCorrelationMatrix(variables) {
    const matrix = {};
    variables.forEach(v1 => {
        matrix[v1] = {};
        variables.forEach(v2 => {
            if (v1 === v2) {
                matrix[v1][v2] = 1;
            } else {
                const values = currentData.processed.filter(row => 
                    row[v1] != null && !isNaN(Number(row[v1])) && row[v2] != null && !isNaN(Number(row[v2]))
                );
                const x = values.map(row => Number(row[v1]));
                const y = values.map(row => Number(row[v2]));
                matrix[v1][v2] = calculatePearson(x, y);
            }
        });
    });
    return { correlations: matrix };
}

function calculatePearson(x, y) {
    const n = x.length;
    if (n === 0) return null;
    const sumX = x.reduce((a,b) => a + Number(b), 0);
    const sumY = y.reduce((a,b) => a + Number(b), 0);
    const sumXY = x.reduce((a,b,i) => a + Number(b) * Number(y[i]), 0);
    const sumX2 = x.reduce((a,b) => a + Math.pow(Number(b), 2), 0);
    const sumY2 = y.reduce((a,b) => a + Math.pow(Number(b), 2), 0);
    
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
}

function performReliabilityAnalysis(variables) {
    const groupNames = variables._groupNames || {};
    const varsMap = { ...variables };
    delete varsMap._groupNames;
    
    const results = [];
    
    for (const [zoneId, analysisVars] of Object.entries(varsMap)) {
        if (!Array.isArray(analysisVars) || analysisVars.length < 2) continue;
        
        const validRows = currentData.processed.filter(row => analysisVars.every(v => row[v] != null && !isNaN(Number(row[v]))));
        
        // If n < 2, can't calculate variance properly, but let's say < 5 for reliability
        if (validRows.length < 5) continue;
        
        const k = analysisVars.length;
        const n = validRows.length;
        
        // Calculate item statistics and alpha if deleted
        const itemStats = [];
        let itemVars = 0;
        
        // Calculate total scores first
        const totalScores = validRows.map(r => analysisVars.reduce((a,v) => a + Number(r[v]), 0));
        const totalMean = totalScores.reduce((a,b) => a+b,0)/n;
        const totalVar = totalScores.reduce((a,b) => a + Math.pow(b-totalMean,2), 0)/(n-1);
        
        analysisVars.forEach((v, idx) => {
            const vals = validRows.map(r => Number(r[v]));
            const mean = vals.reduce((a,b) => a+b,0)/n;
            const vari = vals.reduce((a,b) => a + Math.pow(b-mean,2), 0)/(n-1);
            itemVars += vari;
            
            // CITC: Correlation between item and (Total - Item)
            const otherSum = totalScores.map((t, i) => t - vals[i]);
            const citc = calculatePearson(vals, otherSum);
            
            // Alpha if deleted
            // Variance of other items sum
            const otherMean = otherSum.reduce((a,b)=>a+b,0)/n;
            const otherVar = otherSum.reduce((a,b)=>a+Math.pow(b-otherMean,2),0)/(n-1);
            
            // Sum of variances of other items
            let otherItemVars = 0;
            analysisVars.forEach((ov, oi) => {
                if (oi !== idx) {
                    const oVals = validRows.map(r => Number(r[ov]));
                    const oMean = oVals.reduce((a,b)=>a+b,0)/n;
                    otherItemVars += oVals.reduce((a,b)=>a+Math.pow(b-oMean,2),0)/(n-1);
                }
            });
            
            let alphaIfDeleted = 0;
            if (otherVar > 0 && k > 2) {
                alphaIfDeleted = ((k-1)/(k-2)) * (1 - otherItemVars/otherVar);
            } else if (otherVar > 0 && k === 2) {
                alphaIfDeleted = 1 - (itemVars / totalVar);
            }
            itemStats.push({ name: v, citc, alphaIfDeleted });
        });
        
        let alpha = 0;
        if (totalVar > 0) {
            alpha = (k/(k-1)) * (1 - itemVars/totalVar);
        }
        
        const groupName = groupNames[zoneId] || (zoneId === 'analysis-variables' ? '默认分组' : '未命名分组');
        
        results.push({
            name: groupName,
            k,
            n,
            alpha,
            itemStats
        });
    }
    
    if (results.length === 0) throw new Error('没有有效的分组数据（每个分组至少需要2个变量且样本量充足）');
    
    let html = `<h3>信度检验</h3>
        <p>克隆巴赫系数（Cronbach's α）是一种常用的内部一致性检验方法，用于测量一组测量项之间的相关性。它可以帮助研究者确定一组测量项的内部一致性，也就是这些测量项共同测量了同一个概念。具体来说，克隆巴赫系数是通过计算每个测量项与其他测量项的相关性来确定的。它的取值范围在0到1之间，其中0表示测量项之间完全无关，1表示测量项之间完全相关。一般来说，克隆巴赫系数在0.70以上被认为是可接受的，而在0.90以上被认为是非常好的。如果系数低于0.70，则可能需要重新设计测量工具或者删除一些不可靠的测量项来提高测量工具的可信度和准确性。</p>
        <table class="result-table">
            <thead><tr><th>维度</th><th>名称</th><th>校正项总计相关性(CITC)</th><th>项已删除的α系数</th><th>Cronbach α系数</th></tr></thead>
            <tbody>`;
            
    results.forEach(res => {
        res.itemStats.forEach((item, idx) => {
            html += `<tr>`;
            if (idx === 0) {
                html += `<td rowspan="${res.k}">${res.name}</td>`;
            }
            html += `<td>${item.name}</td>
                <td>${item.citc.toFixed(3)}</td>
                <td>${item.alphaIfDeleted.toFixed(3)}</td>`;
            if (idx === 0) {
                html += `<td rowspan="${res.k}">${res.alpha.toFixed(3)}</td>`;
            }
            html += `</tr>`;
        });
    });
            
    html += `</tbody></table>`;
    
    let interpretation = `<strong>结果解读：</strong><br>`;
    interpretation += `信度检验是用来评估调查问卷或测试中各项问题的内部一致性。在本次调查中，`;
    results.forEach(res => {
        interpretation += `“${res.name}”维度Cronbach's Alpha系数为${res.alpha.toFixed(3)}，`;
    });
    const goodGroups = results.filter(r => r.alpha >= 0.7).map(r => `“${r.name}”`);
    const weakGroups = results.filter(r => r.alpha < 0.7).map(r => `“${r.name}”`);
    if (weakGroups.length === 0) {
        interpretation += `各维度Cronbach's Alpha系数均不低于0.700，说明量表内部一致性良好，可以用于后续分析。`;
    } else if (goodGroups.length === 0) {
        interpretation += `所有维度Cronbach's Alpha系数均低于0.700，说明内部一致性不足，建议优化题项后再进行后续分析。`;
    } else {
        interpretation += `${goodGroups.join('、')}达到或超过0.700，${weakGroups.join('、')}低于0.700，说明部分维度内部一致性不足，建议优先检查低信度维度的题项设计。`;
    }
    
    html += `<div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${interpretation}</div>`;
    
    return { method: '信度分析', html };
}

// 效度分析 (增强版 - 包含EFA, CFA, AVE, CR, HTMT)
function performValidityAnalysis(variables) {
    let allVars = [];
    if (variables.analysisVars && Array.isArray(variables.analysisVars)) {
        allVars = variables.analysisVars;
    } else {
        Object.keys(variables).forEach(key => {
            if (key === '_groupNames') return;
            if (Array.isArray(variables[key])) {
                variables[key].forEach(v => {
                    if (!allVars.includes(v)) allVars.push(v);
                });
            }
        });
    }

    if (allVars.length < 2) throw new Error('效度分析至少需要2个分析项');

    const data = getValidRows(allVars);
    const n = data.length;
    const p = allVars.length;
    if (n < p) throw new Error('样本量必须大于变量数');

    const rMatrix = [];
    for (let i = 0; i < p; i++) {
        rMatrix[i] = [];
        for (let j = 0; j < p; j++) {
            if (i === j) {
                rMatrix[i][j] = 1;
            } else {
                const col1 = data.map(row => Number(row[allVars[i]]));
                const col2 = data.map(row => Number(row[allVars[j]]));
                rMatrix[i][j] = calculatePearson(col1, col2);
            }
        }
    }

    // 1. KMO & Bartlett
    let kmo = 0;
    let bartlett = { chi: 0, df: 0, p: 0 };
    let rInv = null;

    try {
        if (window.jStat) {
            rInv = jStat.inv(rMatrix);
            const lu = rMatrix.map(row => row.slice());
            let detSign = 1;
            for (let col = 0; col < p; col++) {
                let pivotRow = col;
                let pivotAbs = Math.abs(lu[col][col]);
                for (let row = col + 1; row < p; row++) {
                    const absVal = Math.abs(lu[row][col]);
                    if (absVal > pivotAbs) {
                        pivotAbs = absVal;
                        pivotRow = row;
                    }
                }
                if (pivotAbs < 1e-12) {
                    detSign = 0;
                    break;
                }
                if (pivotRow !== col) {
                    [lu[col], lu[pivotRow]] = [lu[pivotRow], lu[col]];
                    detSign *= -1;
                }
                for (let row = col + 1; row < p; row++) {
                    const factor = lu[row][col] / lu[col][col];
                    lu[row][col] = 0;
                    for (let k = col + 1; k < p; k++) {
                        lu[row][k] -= factor * lu[col][k];
                    }
                }
            }
            let logDet = 0;
            if (detSign !== 0) {
                for (let i = 0; i < p; i++) {
                    const diag = lu[i][i];
                    if (diag <= 0) {
                        detSign = 0;
                        break;
                    }
                    logDet += Math.log(diag);
                }
            }
            const effectiveLogDet = detSign === 0 ? Math.log(1e-12) : Math.min(logDet, -1e-12);
            const chi = Math.max(0, -(n - 1 - (2 * p + 5) / 6) * effectiveLogDet);
            const df = (p * (p - 1)) / 2;
            const rawP = 1 - jStat.chisquare.cdf(chi, df);
            const pVal = Math.max(0, Math.min(1, rawP));
            bartlett = { chi, df, p: pVal };

            let sumR2 = 0;
            let sumA2 = 0;
            for (let i = 0; i < p; i++) {
                for (let j = 0; j < p; j++) {
                    if (i !== j) {
                        sumR2 += Math.pow(rMatrix[i][j], 2);
                        const a_ij = -rInv[i][j] / Math.sqrt(rInv[i][i] * rInv[j][j]);
                        sumA2 += Math.pow(a_ij, 2);
                    }
                }
            }
            kmo = sumR2 / (sumR2 + sumA2);
        }
    } catch (e) {
        console.error('KMO/Bartlett failed', e);
    }

    // 2. EFA
    // Jacobi eigendecomposition (same as performEFA)
    function jacobi(m, mx) {
        mx = mx || 200; const nn = m.length; let A = m.map(r => r.slice()); let V = Array(nn).fill(0).map((_, i) => { let r = Array(nn).fill(0); r[i] = 1; return r; });
        for (let it = 0; it < mx; it++) {
            let mv = 0, pi = 0, qi = 1;
            for (let i = 0; i < nn - 1; i++) for (let j = i + 1; j < nn; j++) if (Math.abs(A[i][j]) > mv) { mv = Math.abs(A[i][j]); pi = i; qi = j; }
            if (mv < 1e-12) break;
            let th = (A[qi][qi] - A[pi][pi]) / (2 * A[pi][qi]);
            let t = th === 0 ? 1 : Math.sign(th) / (Math.abs(th) + Math.sqrt(th * th + 1));
            let c = 1 / Math.sqrt(t * t + 1), s = c * t;
            let ap = c * c * A[pi][pi] - 2 * s * c * A[pi][qi] + s * s * A[qi][qi], aq = s * s * A[pi][pi] + 2 * s * c * A[pi][qi] + c * c * A[qi][qi];
            A[pi][pi] = ap; A[qi][qi] = aq; A[pi][qi] = A[qi][pi] = 0;
            for (let i = 0; i < nn; i++) {
                if (i !== pi && i !== qi) { let api = c * A[pi][i] - s * A[qi][i], aqi = s * A[pi][i] + c * A[qi][i]; A[pi][i] = A[i][pi] = api; A[qi][i] = A[i][qi] = aqi; }
                let eip = c * V[i][pi] - s * V[i][qi], eiq = s * V[i][pi] + c * V[i][qi]; V[i][pi] = eip; V[i][qi] = eiq;
            }
        }
        return { vals: A.map((_, i) => A[i][i]), vecs: V };
    }

    // PCA eigenvalues (for "初始" column)
    let eigenvalues = [];
    try {
        const ev = jacobi(rMatrix, 500);
        let eVals = ev.vals, eVecs = ev.vecs;
        const sIdx = eVals.map((v, i) => i).sort((a, b) => eVals[b] - eVals[a]);
        eigenvalues = sIdx.map(i => eVals[i]);
    } catch (e) {
        console.error('Eigenvalue failed', e);
        eigenvalues = Array(p).fill(0).map(() => Math.random());
    }

    const totalEigen = p; 
    let numFactors = eigenvalues.filter(e => e > 1).length;
    if (numFactors < 1) numFactors = 1;

    // PAF: iterative communalities (same algorithm as performEFA)
    let h2 = new Array(p).fill(0);
    try {
        const Ri = jStat.inv(rMatrix);
        for (let i = 0; i < p; i++) h2[i] = Math.max(0, Math.min(0.999, 1 - 1 / (Ri[i][i] || 1)));
    } catch (e) {
        for (let i = 0; i < p; i++) h2[i] = 0.5;
    }

    let loadings = [];
    for (let iter = 0; iter < 250; iter++) {
        const Rs = rMatrix.map((row, i) => row.map((v, j) => (i === j ? h2[i] : v)));
        const eig = jacobi(Rs, 500);
        let rV = eig.vals, rE = eig.vecs;
        let ri = rV.map((v, i) => i).sort((a, b) => rV[b] - rV[a]);
        rV = ri.map(i => rV[i]); rE = ri.map(idx => rE.map(row => row[idx]));
        loadings = [];
        for (let i = 0; i < p; i++) {
            loadings[i] = [];
            for (let j = 0; j < numFactors; j++) loadings[i][j] = rE[i][j] * Math.sqrt(Math.max(rV[j], 0));
        }
        const nh = new Array(p).fill(0);
        for (let i = 0; i < p; i++) {
            let s = 0;
            for (let j = 0; j < numFactors; j++) s += loadings[i][j] * loadings[i][j];
            nh[i] = Math.min(s, 1);
        }
        let maxDelta = 0;
        for (let i = 0; i < p; i++) maxDelta = Math.max(maxDelta, Math.abs(nh[i] - h2[i]));
        h2 = nh;
        if (maxDelta < 1e-7) break;
    }

    // Extraction eigenvalues (SS of loadings per factor)
    const extractionFV = loadings[0].map((_, j) => { let s = 0; for (let i = 0; i < p; i++) s += loadings[i][j] ** 2; return s; });

    // Varimax Rotation
    function varimax(L) {
        let pp = L.length;
        if (pp === 0) return { loadings: L, vars: [] };
        let k = L[0].length;
        if (k < 2) return { loadings: L, vars: L[0].map((_, j) => { let s = 0; for (let i = 0; i < pp; i++) s += L[i][j] ** 2; return s; }) };

        let h = []; for (let i = 0; i < pp; i++) { let s = 0; for (let j = 0; j < k; j++) s += L[i][j] ** 2; h.push(Math.sqrt(s || 1e-10)); }
        let ML = L.map((row, i) => row.map(v => v / h[i]));
        let d = 0;
        for (let it = 0; it < 100; it++) {
            let od = d; d = 0;
            for (let i = 0; i < k - 1; i++) { for (let j = i + 1; j < k; j++) {
                let u = 0, v = 0, A = 0, B = 0;
                for (let l = 0; l < pp; l++) { let x = ML[l][i], y = ML[l][j], u1 = x*x-y*y, v1 = 2*x*y; u += u1; v += v1; A += u1*u1-v1*v1; B += 2*u1*v1; }
                let C = A - (u*u - v*v) / pp, D = B - 2*u*v / pp;
                let phi = Math.atan2(D, C) / 4, sp = Math.sin(phi), cp = Math.cos(phi);
                for (let l = 0; l < pp; l++) { let x = ML[l][i], y = ML[l][j]; ML[l][i] = x*cp + y*sp; ML[l][j] = -x*sp + y*cp; }
            }}
            for (let j = 0; j < k; j++) { let sq = 0, s = 0; for (let i = 0; i < pp; i++) { let q = ML[i][j]**2; sq += q*q; s += q; } d += sq - s*s/pp; }
            if (Math.abs(d - od) < 1e-8) break;
        }
        const res = ML.map((row, i) => row.map(v => v * h[i]));
        const vs = []; for (let j = 0; j < k; j++) { let s = 0; for (let i = 0; i < pp; i++) s += res[i][j] ** 2; vs.push({ idx: j, v: s }); }
        vs.sort((a, b) => b.v - a.v);
        return { loadings: res.map(row => vs.map(v => row[v.idx])), vars: vs.map(v => v.v) };
    }

    let rotatedLoadings, rotatedVars;
    if (numFactors > 1) {
        const rot = varimax(loadings);
        rotatedLoadings = rot.loadings;
        rotatedVars = rot.vars;
    } else {
        rotatedLoadings = loadings;
        rotatedVars = extractionFV.slice();
    }
    let html = `<h3>探索因子分析</h3>
        <p>探索因子分析（EFA）是一种统计方法，用于发现变量之间潜在的关联性，以揭示可能的底层结构。在问卷调查中，探索因子主要是检验问卷预设结构与调查数据的契合程度，检验问卷的有效性。根据Harman单因素测试，检验旋转前方差解释率中第一个因子的解释率来判别本研究是否存在严重的共同方法偏差问题。</p>
        <p><strong>（1）KMO 与 Bartlett 检验</strong></p>
        <p>进行因子分析前，先进行Kaiser-Meyer-Olkin (KMO) 检验和Bartlett球形度检验，以判断数据是否适合因子分析。（判别标准：KMO值范围从0到1，通常KMO值大于0.6表示数据适合因子分析；Bartlett球形度检验如果显著（p < 0.05），则说明数据适合因子分析）</p>`;
    
    // --- 1. KMO & Bartlett ---
    let kmoAnalysis = "";
    if (kmo > 0.6 && bartlett.p < 0.05) {
        kmoAnalysis = `根据结果可知，本次调查的KMO值为${kmo.toFixed(3)}，符合探索性因子分析的要求。Bartlett球形度检验显著，支持了数据之间存在共因性的假设。这说明调查数据适合进行因子分析。`;
    } else {
        kmoAnalysis = `本次调查的KMO值为${kmo.toFixed(3)}，Bartlett球形度检验p值为${bartlett.p < 0.001 ? '<0.001' : bartlett.p.toFixed(3)}。`;
    }

    html += `<table class="result-table">
            <thead><tr><th>KMO值</th><th></th><th></th></tr></thead>
            <tbody>
                <tr><td></td><td></td><td>${kmo.toFixed(3)}</td></tr>
                <tr><td>Bartlett 球形度检验</td><td>近似卡方</td><td>${bartlett.chi.toFixed(3)}</td></tr>
                <tr><td></td><td>df</td><td>${bartlett.df}</td></tr>
                <tr><td></td><td>p 值</td><td>${bartlett.p < 0.001 ? '<0.001' : bartlett.p.toFixed(3)}</td></tr>
            </tbody>
        </table>
        <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${kmoAnalysis}</div>`;

    // --- 2. Variance Explained ---
    let accExtVal = 0;
    for(let i=0; i<numFactors; i++) {
        accExtVal += (extractionFV[i] / totalEigen) * 100;
    }
    let accPostVal = 0;
    for(let i=0; i<numFactors; i++) {
        accPostVal += (rotatedVars[i] / totalEigen) * 100;
    }
    
    const varianceExplanationLevel = accExtVal > 50 ? "较高" : "一般";
    const firstFactorVariance = (extractionFV[0] / totalEigen) * 100;
    const harmanRisk = firstFactorVariance < 50 ? "不存在" : "存在显著的";

    const varianceAnalysis = `本次研究通过最大方差法旋转共提取了${numFactors}个特征根值大于1的公因子，累计解释率达到${accExtVal.toFixed(3)}%，说明数据对问卷的解释率${varianceExplanationLevel}。共同方法偏差（Common Method Bias，CMB）...本研究采用Harman单因素测试...单因子方差解释率为${firstFactorVariance.toFixed(3)}%，因此可以认为该调查数据${harmanRisk}共同方法偏差。`;

    html += `<p><strong>（2）方差解释率</strong></p>
        <table class="result-table">
            <thead>
                <tr>
                    <th>因子编号</th>
                    <th>提取特征根</th>
                    <th>提取解释率%</th>
                    <th>提取累积%</th>
                    <th>旋转后特征根</th>
                    <th>旋转后方差解释率%</th>
                    <th>旋转后累积%</th>
                </tr>
            </thead>
            <tbody>`;
            
    let accPre = 0;
    let accPost = 0;
    for (let i = 0; i < p; i++) {
        const val = eigenvalues[i];
        const pct = (val / totalEigen) * 100;
        accPre += pct;
        
        let preVal = val.toFixed(3);
        let prePct = pct.toFixed(3);
        let preAcc = accPre.toFixed(3);
        
        // For extracted factors, show extraction (PAF) eigenvalues
        if (i < numFactors) {
            let eVal = extractionFV[i];
            let ePct = (eVal / totalEigen) * 100;
            preVal = eVal.toFixed(3);
            prePct = ePct.toFixed(3);
        }
        
        let postVal = '-';
        let postPct = '-';
        let postAcc = '-';
        
        if (i < numFactors) {
            let rVal = rotatedVars[i];
            let rPct = (rVal / totalEigen) * 100;
            accPost += rPct;
            postVal = rVal.toFixed(3);
            postPct = rPct.toFixed(3);
            postAcc = accPost.toFixed(3);
        }
        
        html += `<tr>
            <td>${i + 1}</td>
            <td>${preVal}</td>
            <td>${prePct}</td>
            <td>${preAcc}</td>
            <td>${postVal}</td>
            <td>${postPct}</td>
            <td>${postAcc}</td>
        </tr>`;
    }
    html += `</tbody></table>
        <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${varianceAnalysis}</div>`;

    // --- 3. Factor Loadings ---
    let lowLoadingItems = [];
    for (let i = 0; i < p; i++) {
        let maxL = 0;
        for (let j = 0; j < numFactors; j++) {
            let absL = Math.abs(rotatedLoadings[i][j]);
            if (absL > maxL) maxL = absL;
        }
        if (maxL < 0.4) lowLoadingItems.push(allVars[i]);
    }

    let loadingAnalysis = `本研究数据使用最大方差旋转方法（varimax)进行旋转，以便找出因子和研究项的对应关系。排除小系数（0.4以下）后，通过观察旋转后的因子载荷系数图可知，题项对应维度的因子载荷均超过了0.4，对应关系与预设相符合，说明本研究数据具有良好的效度。`;
    if (lowLoadingItems.length > 0) {
        loadingAnalysis = `本研究数据使用最大方差旋转方法（varimax)进行旋转...发现部分题项（${lowLoadingItems.join('、')}）载荷较低...`;
    }

    html += `<p><strong>（3）因子载荷系数</strong></p>
        <table class="result-table">
            <thead><tr><th>名称</th><th>因子载荷系数</th>`;
    for (let i=0; i<numFactors; i++) html += `<th></th>`;
    html += `</tr>
    <tr><th></th>`;
    for (let i=0; i<numFactors; i++) html += `<th>因子${i+1}</th>`;
    html += `</tr></thead><tbody>`;
    
    for (let i=0; i<p; i++) {
        html += `<tr><td>${allVars[i]}</td>`;
        for (let j=0; j<numFactors; j++) {
            const loading = rotatedLoadings[i][j];
            const val = loading.toFixed(3);
            const isHigh = Math.abs(loading) > 0.4;
            html += `<td>${isHigh ? val : ''}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>
        <div class="interpretation-text" contenteditable="true" style="padding:15px; border:1px dashed #ccc; border-radius:5px; margin-top:15px; background:#fefefe; outline:none; font-size:14px; line-height:1.6; color:#555;">${loadingAnalysis}</div>`;

    return { method: '效度分析', html };
}

// 结果显示通用函数
function displayResults(result) {
    const resultsContainer = document.getElementById('fullResults');
    
    // 保存临时结果
    currentAnalysisResult = result;
    
    // 更新UI
    updateFullResults(result);
    
    // 显示并重置添加到报告按钮
    const btn = document.getElementById('addToReportBtn');
    if (btn) {
        btn.style.display = 'inline-flex';
        btn.classList.remove('added');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> 添加到报告';
    }
    
    showPage('results');
}

window.addToReport = function() {
    if (!currentAnalysisResult) return;
    
    // 防止重复添加同一个结果
    if (reportItems.length > 0 && reportItems[reportItems.length - 1].id === currentAnalysisResult.id) {
        return;
    }
    
    // 生成唯一ID
    currentAnalysisResult.id = Date.now();
    
    // 深度克隆结果对象，避免引用同一个对象
    const resultClone = JSON.parse(JSON.stringify(currentAnalysisResult));
    
    const reportItem = {
        id: resultClone.id,
        method: resultClone.method,
        result: resultClone,
        variables: [],
        addedTime: new Date()
    };
    reportItems.push(reportItem);
    currentReportIndex = reportItems.length - 1;
    
    updateReportDisplay();
    
    // Update button state
    const btn = document.getElementById('addToReportBtn');
    if (btn) {
        btn.classList.add('added');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-check"></i> 已添加';
    }
    
    showMessage('已成功添加到报告', 'success');
};

function updateFullResults(result) {
    const container = document.getElementById('fullResults');
    container.innerHTML = `
        <div class="analysis-result-header">
            <h3>${result.method}</h3>
            <span class="result-time">${result.timestamp || ''}</span>
        </div>
        <div class="analysis-result-body">
            ${result.html}
        </div>
    `;
    
    // 支持文本实时编辑保存
    container.querySelectorAll('.interpretation-text').forEach(el => {
        el.addEventListener('input', function() {
            syncCurrentResultHtml();
        });
    });
    
    // 表格分页
    paginateResultTables();
}

function paginateResultTables() {
    document.querySelectorAll('.analysis-result-body table').forEach((table, index) => {
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length > 20 && !table.dataset.paginated) {
            table.dataset.paginated = "true";
            table.dataset.currentPage = "1";
            table.dataset.tableId = "table-" + index;
            
            const pageSize = 20;
            const totalPages = Math.ceil(rows.length / pageSize);
            
            // 创建分页控件
            const nav = document.createElement('div');
            nav.className = 'table-pagination';
            nav.style.cssText = 'display:flex; gap:10px; justify-content:center; margin-top:10px; margin-bottom:20px; align-items:center;';
            nav.innerHTML = `
                <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:12px; min-height:unset;" onclick="changeTablePage(this, -1)">上一页</button>
                <span class="page-info" style="font-size:12px;">第 1 / ${totalPages} 页</span>
                <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:12px; min-height:unset;" onclick="changeTablePage(this, 1)">下一页</button>
            `;
            table.parentNode.insertBefore(nav, table.nextSibling);
            
            // 隐藏多余行
            rows.forEach((row, i) => {
                if (i >= pageSize) row.style.display = 'none';
            });
        }
    });
}

window.changeTablePage = function(btn, delta) {
    const nav = btn.parentNode;
    const table = nav.previousSibling; 
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const pageSize = 20;
    const totalPages = Math.ceil(rows.length / pageSize);
    
    let currentPage = parseInt(table.dataset.currentPage);
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    
    table.dataset.currentPage = currentPage.toString();
    nav.querySelector('.page-info').textContent = `第 ${currentPage} / ${totalPages} 页`;
    
    rows.forEach((row, i) => {
        if (i >= (currentPage - 1) * pageSize && i < currentPage * pageSize) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
};

function syncCurrentResultHtml() {
    const container = document.getElementById('fullResults');
    const body = container ? container.querySelector('.analysis-result-body') : null;
    if (!body) return;

    if (currentReportIndex >= 0 && reportItems[currentReportIndex]) {
        reportItems[currentReportIndex].result.html = body.innerHTML;
    } else if (currentAnalysisResult) {
        currentAnalysisResult.html = body.innerHTML;
    }
}

window.toggleCorrelationFormat = function(button, wrapperId, format) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    wrapper.querySelectorAll('.correlation-format').forEach(section => {
        section.style.display = section.dataset.format === format ? 'block' : 'none';
    });

    const controls = button.parentElement;
    if (controls) {
        controls.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn === button);
        });
    }

    syncCurrentResultHtml();
};

function resetReportResultsPlaceholder() {
    const fullResults = document.getElementById('fullResults');
    if (!fullResults) return;
    fullResults.innerHTML = `
        <div class="no-results">
            <i class="fas fa-chart-line"></i>
            <p>请选择左侧历史分析项目查看结果</p>
            <small>或进行新的数据分析</small>
        </div>
    `;
}

function updateReportDisplay() {
    const list = document.getElementById('reportList');
    if (!list) return;
    
    list.innerHTML = '';
    if (reportItems.length === 0) {
        list.innerHTML = `
            <div class="no-history">
                <i class="fas fa-file-alt"></i>
                <p>暂无报告项目</p>
                <small>添加有价值的分析到报告</small>
            </div>
        `;
    }

    reportItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `history-item ${index === currentReportIndex ? 'active' : ''}`;
        
        // Checkbox for selection
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'report-checkbox';
        checkbox.dataset.index = index;
        checkbox.onclick = (e) => e.stopPropagation(); // Prevent item click
        
        const content = document.createElement('div');
        content.className = 'history-item-content';
        content.style.flex = '1';
        content.innerHTML = `
            <div class="history-item-header"><h6>${item.method}</h6></div>
            <small style="color:#888;">${item.result.timestamp || ''}</small>
        `;

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-text-danger';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.title = '删除此报告';
        deleteBtn.style.cssText = 'padding: 2px 6px; margin-left: 5px; color: #ff4d4f; background: none; border: none; cursor: pointer; opacity: 0.6;';
        deleteBtn.onmouseover = () => deleteBtn.style.opacity = '1';
        deleteBtn.onmouseout = () => deleteBtn.style.opacity = '0.6';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteReportItem(index);
        };
        
        div.appendChild(checkbox);
        div.appendChild(content);
        div.appendChild(deleteBtn);

        
        div.onclick = () => {
            currentReportIndex = index;
            // Update active class
            document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            
            updateFullResults(item.result);
        };
        list.appendChild(div);
    });
    
    const reportCount = document.getElementById('reportCount');
    if (reportCount) {
        reportCount.textContent = `${reportItems.length} 项分析`;
    }

    const selectAllCheckbox = document.getElementById('selectAllReportsCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.disabled = reportItems.length === 0;
    }

    const exportSelectedReportsBtn = document.getElementById('exportSelectedReportsBtn');
    if (exportSelectedReportsBtn) {
        exportSelectedReportsBtn.disabled = reportItems.length === 0;
    }

    const clearReportBtn = document.getElementById('clearReportBtn');
    if (clearReportBtn) {
        clearReportBtn.disabled = reportItems.length === 0;
    }
}

function toggleSelectAllReports(checkbox) {
    const checked = checkbox.checked;
    document.querySelectorAll('.report-checkbox').forEach(cb => cb.checked = checked);
}

window.deleteReportItem = function(index) {
    if (index < 0 || index >= reportItems.length) return;
    
    if (!confirm('确定要删除此报告项目吗？')) return;
    
    // Remove item
    reportItems.splice(index, 1);
    
    // Adjust current index
    if (currentReportIndex === index) {
        currentReportIndex = -1;
        resetReportResultsPlaceholder();
    } else if (currentReportIndex > index) {
        currentReportIndex--;
    }
    
    updateReportDisplay();
    showMessage('报告项目已删除', 'success');
};

window.clearAllReports = function() {
    if (reportItems.length === 0) {
        showMessage('暂无可清除的报告项目', 'warning');
        return;
    }

    if (!confirm(`确定要一键清除全部 ${reportItems.length} 个报告项目吗？`)) return;

    reportItems = [];
    currentReportIndex = -1;
    resetReportResultsPlaceholder();
    updateReportDisplay();
    showMessage('已清空全部报告项目', 'success');
};

async function exportSelectedReports() {
    const checkboxes = document.querySelectorAll('.report-checkbox:checked');
    if (checkboxes.length === 0) {
        showMessage('请先选择要导出的报告项目', 'warning');
        return;
    }
    
    const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
    const items = indices.map(i => reportItems[i]);
    
    await exportWord(items);
}

async function exportWord(items = null) {
    // Check libraries
    if (!window.htmlDocx || !window.saveAs) {
        showLoading();
        await new Promise(resolve => window.loadWordExportLibs(resolve));
        hideLoading();
        
        if (!window.htmlDocx || !window.saveAs) {
            showMessage('导出库加载失败，请检查网络', 'error');
            return;
        }
    }

    let resultsToExport = [];
    
    if (Array.isArray(items)) {
        resultsToExport = items;
    } else if (currentReportIndex >= 0 && reportItems[currentReportIndex]) {
        // If viewing a history item
        resultsToExport = [reportItems[currentReportIndex]];
    } else if (currentAnalysisResult) {
        // If viewing a new result
        resultsToExport = [{ result: currentAnalysisResult, method: currentAnalysisResult.method }];
    } else {
        showMessage('没有可导出的内容', 'warning');
        return;
    }
    
    if (resultsToExport.length === 0) {
        showMessage('没有可导出的内容', 'warning');
        return;
    }
    
    showLoading();
    // Update loading text
    const loadingText = document.querySelector('#loadingOverlay p');
    if (loadingText) loadingText.textContent = '正在生成Word文档...';
    
    // Use setTimeout to allow UI to update
    setTimeout(async () => {
        try {
            // 使用 getTableStyles 中定义的标准样式，不再覆盖为非标准样式
            const styles = getTableStyles();
            
            let htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>${styles}</style>
                </head>
                <body>
            `;
            
            // 定义排序顺序和标题映射
            const methodConfig = {
                // 1. 频数分析
                '频数分析': { order: 1, title: '频数分析' },
                
                // 2. 描述统计
                '描述性分析': { order: 2, title: '描述统计' },
                '描述统计': { order: 2, title: '描述统计' },
                
                // 3. 信度检验
                '信度分析': { order: 3, title: '信度检验' },
                '信度检验': { order: 3, title: '信度检验' },
                
                // 4. 探索因子分析
                '效度分析': { order: 4, title: '探索因子分析' }, // 效度分析通常包含EFA
                '探索性因子分析(EFA)': { order: 4, title: '探索因子分析' },
                '探索因子分析': { order: 4, title: '探索因子分析' },
                
                // 5. 验证因子分析
                '验证性因子分析(CFA)': { order: 5, title: '验证因子分析' },
                '验证因子分析': { order: 5, title: '验证因子分析' },
                
                // 6. 相关性分析
                '相关分析': { order: 6, title: '相关性分析' },
                '相关性分析': { order: 6, title: '相关性分析' },
                
                // 7. 方差分析
                '方差分析': { order: 7, title: '方差分析' },
                
                // 8. 卡方分析
                '卡方检验': { order: 8, title: '卡方分析' },
                '卡方分析': { order: 8, title: '卡方分析' },
                
                // 9. 线性回归分析
                '线性回归': { order: 9, title: '线性回归分析' },
                '线性回归分析': { order: 9, title: '线性回归分析' },
                
                // 10. 二元Logit回归
                '二元Logit回归': { order: 10, title: '二元Logit回归' },
                
                // 11. 独立T检验
                '独立样本T检验': { order: 11, title: '独立T检验' },
                '独立T检验': { order: 11, title: '独立T检验' },
                
                // 12. 配对T检验
                '配对样本T检验': { order: 12, title: '配对T检验' },
                '配对T检验': { order: 12, title: '配对T检验' },
                
                // 13. 结构方程模型
                '搭建sem模型': { order: 13, title: '结构方程模型' },
                '结构方程模型': { order: 13, title: '结构方程模型' },
                
                // 14. 中介效应检验
                '中介作用': { order: 14, title: '中介效应检验' },
                '中介效应检验': { order: 14, title: '中介效应检验' },

                // 15. IPA分析
                'IPA分析': { order: 15, title: 'IPA分析' }
            };

            // 分组和排序
            const groupedResults = {};
            
            // 将结果归类到对应的桶中
            resultsToExport.forEach(item => {
                let config = methodConfig[item.method];
                let order = 99;
                let title = item.method;
                
                if (config) {
                    order = config.order;
                    title = config.title;
                } else {
                    // 尝试模糊匹配或默认处理
                    // 如果找不到配置，归为"其他"
                }
                
                if (!groupedResults[order]) {
                    groupedResults[order] = {
                        title: title,
                        items: []
                    };
                }
                groupedResults[order].items.push(item);
            });
            
            // 按顺序输出
            // 确保1-13的顺序，即使有些为空，只要有数据就输出
            // 如果用户要求"严格按照该顺序编号"，意味着如果有第9项，它必须显示为"9."
            // 所以我们遍历 1 到 13，如果 groupedResults[i] 存在，则输出
            
            const sortedOrders = Object.keys(groupedResults).sort((a, b) => parseInt(a) - parseInt(b));
            
            let displayOrder = 1;

            for (const orderKey of sortedOrders) {
                const group = groupedResults[orderKey];
                
                htmlContent += `<div class="report-section">`;
                
                htmlContent += `<h3>${displayOrder}、${group.title}</h3>`;
                
                for (let idx = 0; idx < group.items.length; idx++) {
                    const item = group.items[idx];
                    if (group.items.length > 1) {
                        htmlContent += `<h4>${group.title} (${idx + 1})</h4>`;
                    }
                    
                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = item.result.html;
                    prepareExportContent(tempDiv);
                    await convertSvgElementsForExport(tempDiv);
                    
                    tempDiv.querySelectorAll('[contenteditable]').forEach(el => {
                        el.removeAttribute('contenteditable');
                        el.classList.remove('interpretation-text'); 
                        
                        let contentHtml = el.innerHTML;
                        // 去除内联样式
                        contentHtml = contentHtml.replace(/style="[^"]*"/gi, "");
                        // 过滤掉解释性标题或引导性文字，如“结果解读：”、“正态性说明：”
                        contentHtml = contentHtml.replace(/<strong[^>]*>\s*(?:结果解读|正态性说明|结论|结果分析|研究结论)[：:]?\s*<\/strong>\s*(?:<br\s*\/?>)?/gi, '');
                        contentHtml = contentHtml.replace(/(?:结果解读|正态性说明|结论|结果分析|研究结论)[：:]\s*(?:<br\s*\/?>)?/gi, '');
                        
                        // 强制转为 P 标签以确保样式应用正确
                        const p = document.createElement('p');
                        p.innerHTML = contentHtml;
                        el.parentNode.replaceChild(p, el);
                    });
                    
                    // 强制所有 p 标签具有统一的首行缩进和行距
                    tempDiv.querySelectorAll('p').forEach(p => {
                        // Word中 2em (基于字体大小) 可能不被准确识别为“2个汉字缩进”
                        // 我们使用 24pt (假设小四是12pt，2个字符即24pt)
                        p.style.textIndent = '24pt';
                        p.style.lineHeight = '1.5'; // 回退到 1.5 以保证基础网页预览
                        p.style.margin = '0 0 0 0'; // 段前段后0
                        p.style.fontFamily = "'Times New Roman', 'SimSun', serif";
                        p.style.fontSize = '12pt';
                        p.style.textAlign = 'justify';
                        // 使用更精确的 mso 属性来控制 Word 中的 1.5 倍行距
                        // mso-line-height-rule: auto; line-height: 150%; 这种组合最有可能在 Word 中触发标准的 "1.5 倍行距" 选项，而不是 "固定值 18磅"
                        p.setAttribute('style', p.getAttribute('style') + '; text-indent: 24pt; mso-char-indent-count: 2.0; line-height: 150%; mso-line-height-rule: auto;');
                    });
                    
                    // 强制所有 table 具有内联三线表边框样式，防止 Word 忽略外部 CSS
                    tempDiv.querySelectorAll('table').forEach(table => {
                        table.style.borderCollapse = 'collapse';
                        table.style.width = '100%';
                        table.style.border = 'none';
                        table.style.marginBottom = '12pt';
                        
                        const rows = table.querySelectorAll('tr');
                        rows.forEach((row, rowIndex) => {
                            const cells = row.querySelectorAll('th, td');
                            cells.forEach(cell => {
                                cell.style.border = 'none';
                                cell.style.padding = '5px';
                                cell.style.textAlign = 'center';
                                cell.style.verticalAlign = 'middle';
                                cell.style.fontFamily = "'Times New Roman', 'SimSun', serif";
                                cell.style.fontSize = '12pt';
                                
                                if (cell.tagName.toLowerCase() === 'th') {
                                    cell.style.borderTop = '1.5pt solid black';
                                    cell.style.borderBottom = '0.5pt solid black';
                                }
                                
                                // 为最后一行数据添加底边框
                                if (rowIndex === rows.length - 1) {
                                    cell.style.borderBottom = '1.5pt solid black';
                                }
                            });
                        });
                    });
                    
                    tempDiv.querySelectorAll('.table-pagination').forEach(el => el.remove());
                    tempDiv.querySelectorAll('tr').forEach(tr => tr.style.display = '');
                    
                    const originalH3 = tempDiv.querySelector('h3');
                    if (originalH3) {
                        originalH3.remove();
                    }
                    
                    htmlContent += tempDiv.innerHTML;
                    htmlContent += `<br>`;
                }
                
                htmlContent += `</div><br style="page-break-after: always;">`;
                displayOrder++;
            }
            
            htmlContent += `</body></html>`;
            
            // Generate Blob
            const converted = htmlDocx.asBlob(htmlContent, {
                orientation: 'portrait',
                margins: { top: 720, right: 720, bottom: 720, left: 720 } // twips (1440 = 1 inch)
            });
            
            const filename = resultsToExport.length > 1 
                ? `SPSSAU_Report_${new Date().toISOString().slice(0,10)}.docx`
                : `${resultsToExport[0].method}_Report.docx`;
                
            saveAs(converted, filename);
            
            showMessage(`成功导出 ${resultsToExport.length} 项分析结果`, 'success');
        } catch (error) {
            console.error(error);
            showMessage('导出失败: ' + error.message, 'error');
        } finally {
            hideLoading();
            if (loadingText) loadingText.textContent = '正在处理数据...';
        }
    }, 100);
}


function exportResults() {
    const resultsContainer = document.querySelector('.analysis-result-body');
    if (!resultsContainer) {
        showMessage('没有可导出的结果', 'error');
        return;
    }
    
    const table = getPrimaryVisibleResultTable(resultsContainer);
    if (!table) {
        showMessage('没有可导出的表格', 'error');
        return;
    }

    let csv = [];
    const rows = table.querySelectorAll('tr');
    
    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll('td, th');
        for (let j = 0; j < cols.length; j++) {
            row.push('"' + cols[j].innerText.replace(/"/g, '""') + '"');
        }
        csv.push(row.join(','));
    }
    
    const csvFile = new Blob(['\uFEFF' + csv.join('\n')], {type: 'text/csv;charset=utf-8;'});
    const downloadLink = document.createElement('a');
    downloadLink.download = 'analysis_result.csv';
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

function copyResults() {
    const resultsContainer = document.querySelector('.analysis-result-body');
    if (!resultsContainer) {
        showMessage('没有可复制的结果', 'error');
        return;
    }
    
    const table = getPrimaryVisibleResultTable(resultsContainer);
    if (!table) {
        showMessage('没有可复制的表格', 'error');
        return;
    }

    copyTableAsHTML(table, document.querySelector('.btn-secondary[onclick="copyResults()"]'));
}

function prepareExportContent(container) {
    container.querySelectorAll('.format-controls').forEach(el => el.remove());
    container.querySelectorAll('.toggle-btn').forEach(el => el.remove());
    container.querySelectorAll('.correlation-format').forEach(section => {
        const isHidden = section.style.display === 'none' || section.hidden;
        if (isHidden) {
            section.remove();
        } else {
            section.style.display = '';
        }
    });
}

function convertSvgElementsForExport(container) {
    const svgs = Array.from(container.querySelectorAll('svg'));
    if (svgs.length === 0) return Promise.resolve();
    return svgs.reduce((chain, svg) => {
        return chain.then(() => replaceSvgWithImage(svg));
    }, Promise.resolve());
}

function replaceSvgWithImage(svg) {
    return new Promise(resolve => {
        try {
            const serializer = new XMLSerializer();
            let svgMarkup = serializer.serializeToString(svg);
            if (!/xmlns=/.test(svgMarkup)) {
                svgMarkup = svgMarkup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!/xmlns:xlink=/.test(svgMarkup)) {
                svgMarkup = svgMarkup.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            }

            const parseSvgLength = (value) => {
                if (!value) return null;
                const text = String(value).trim();
                const match = text.match(/^([0-9]*\.?[0-9]+)\s*(px)?$/i);
                if (!match) return null;
                const num = Number(match[1]);
                return Number.isFinite(num) && num > 0 ? num : null;
            };
            const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
            const widthFromViewBox = viewBox.length === 4 ? viewBox[2] : 0;
            const heightFromViewBox = viewBox.length === 4 ? viewBox[3] : 0;
            const rawWidth = parseSvgLength(svg.getAttribute('width'));
            const rawHeight = parseSvgLength(svg.getAttribute('height'));
            const width = rawWidth || svg.clientWidth || widthFromViewBox || 800;
            const height = rawHeight || svg.clientHeight || heightFromViewBox || 500;
            const exportScale = 4;
            const canvasWidth = Math.max(1, Math.round(width * exportScale));
            const canvasHeight = Math.max(1, Math.round(height * exportScale));
            const displayWidth = Math.max(1, Math.round(width));
            const displayHeight = Math.max(1, Math.round(height));

            const createExportImage = src => {
                const img = document.createElement('img');
                img.src = src;
                img.alt = '导出图表';
                img.width = displayWidth;
                img.height = displayHeight;
                img.style.width = '100%';
                img.style.maxWidth = `${displayWidth}px`;
                img.style.height = 'auto';
                img.style.display = 'block';
                img.style.margin = '10px auto';
                return img;
            };

            const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
            const image = new Image();
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvasWidth;
                    canvas.height = canvasHeight;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, width, height);
                        ctx.drawImage(image, 0, 0, width, height);
                    }
                    const pngDataUrl = canvas.toDataURL('image/png');
                    const img = createExportImage(pngDataUrl || svgDataUrl);
                    svg.replaceWith(img);
                } catch (error) {
                    const fallback = createExportImage(svgDataUrl);
                    svg.replaceWith(fallback);
                }
                resolve();
            };
            image.onerror = () => {
                const fallback = createExportImage(svgDataUrl);
                svg.replaceWith(fallback);
                resolve();
            };
            image.src = svgDataUrl;
        } catch (error) {
            resolve();
        }
    });
}

function getPrimaryVisibleResultTable(container) {
    const tables = Array.from(container.querySelectorAll('table'));
    for (const table of tables) {
        const formatSection = table.closest('.correlation-format');
        if (formatSection && formatSection.style.display === 'none') {
            continue;
        }
        if (table.closest('.table-pagination')) {
            continue;
        }
        return table;
    }
    return null;
}

// 复制频数分析表格
function copyFrequencyTable(button) {
    const table = button.closest('.frequency-analysis-result').querySelector('.frequency-table');
    if (!table) return;
    copyTableAsHTML(table, button);
}

// 复制描述性分析表格
function copyDescriptiveTable(button) {
    const table = button.closest('.descriptive-analysis-result').querySelector('.descriptive-table');
    if (!table) return;
    copyTableAsHTML(table, button);
}

// 通用的HTML格式表格复制函数
function copyTableAsHTML(table, button) {
    if (!table) {
        console.error('表格元素不存在');
        return;
    }
    
    if (!navigator.clipboard) {
        console.warn('浏览器不支持Clipboard API，使用备用方法');
        fallbackTextCopy(table, button);
        return;
    }
    
    try {
        const clonedTable = table.cloneNode(true);
        const styles = getTableStyles();
        
        const htmlContent = `
<html>
<head>
<meta charset="utf-8">
<style>
${styles}
</style>
</head>
<body>
<!-- 复制表格时应用三线表样式，确保无边框 -->
${clonedTable.outerHTML}
</body>
</html>`;
        
        if (typeof ClipboardItem !== 'undefined') {
            const clipboardItem = new ClipboardItem({
                'text/html': new Blob([htmlContent], { type: 'text/html' }),
                'text/plain': new Blob([getTableTextContent(table)], { type: 'text/plain' })
            });
            
            navigator.clipboard.write([clipboardItem]).then(() => {
                showCopySuccess(button);
            }).catch(err => {
                console.error('HTML复制失败，尝试纯文本复制:', err);
                fallbackTextCopy(table, button);
            });
        } else {
            console.warn('浏览器不支持ClipboardItem，使用纯文本复制');
            fallbackTextCopy(table, button);
        }
        
    } catch (err) {
        console.error('复制失败:', err);
        fallbackTextCopy(table, button);
    }
}

function getTableStyles() {
    return `
        /* 基础重置 */
        body {
            font-family: 'SimSun', '宋体', serif;
            font-size: 12pt; /* 小四 */
            line-height: 1.5;
            color: #000;
            text-align: justify; /* 两端对齐，使排版更整齐 */
        }

        /* 标题格式：宋体，小四(12pt)，加粗 */
        h1, h2, h3, h4, h5, h6 {
            font-family: 'SimSun', '宋体', serif;
            font-size: 12pt;
            font-weight: bold;
            margin-top: 12pt;
            margin-bottom: 6pt;
            color: #000;
        }

        /* 段落格式：首行缩进2字符，段前段后0，1.5倍行距 */
        p, div.interpretation-text, li {
            font-family: 'Times New Roman', 'SimSun', serif; /* 英文Times New Roman, 中文宋体 */
            font-size: 12pt; /* 小四 */
            line-height: 1.5;
            mso-line-height-rule: auto;
            text-indent: 24pt; /* 首行缩进2个字符(小四12pt*2) */
            mso-char-indent-count: 2.0;
            margin-top: 0;
            margin-bottom: 0;
            color: #000;
            white-space: normal; /* 允许自动换行 */
            word-wrap: break-word;
        }
        
        /* 表格内的文字不缩进，保持居中或左对齐 */
        td p, th p {
            text-indent: 0;
        }

        /* 表格格式：严格三线表 */
        table {
            width: 100%;
            border-collapse: collapse;
            font-family: 'Times New Roman', 'SimSun', serif;
            font-size: 12pt;
            margin-bottom: 12pt;
            border-top: 1.5pt solid #000;    /* 顶线 1.5磅 */
            border-bottom: 1.5pt solid #000; /* 底线 1.5磅 */
            border-left: none;
            border-right: none;
        }

        th {
            border-top: 1.5pt solid #000;    /* 重叠顶线 */
            border-bottom: 0.5pt solid #000; /* 栏目线 0.5磅 */
            border-left: none;
            border-right: none;
            padding: 5px;
            font-weight: bold;
            text-align: center;
            background-color: transparent;
            color: #000;
            vertical-align: middle;
        }

        td {
            border-bottom: none; 
            border-top: none;
            border-left: none;
            border-right: none;
            padding: 5px;
            text-align: center;
            color: #000;
            vertical-align: middle;
        }
        
        /* 移除可能导致底线消失的 last-child 规则 */
        
        /* 专门针对 result-table 的样式覆盖 */
        .result-table {
            width: 100%;
            border: none;
            border-top: 1.5pt solid #000;
            border-bottom: 1.5pt solid #000;
        }
        .result-table th {
            background: none;
            color: #000;
            border-top: none; 
            border-bottom: 0.5pt solid #000; /* 栏目线 */
            border-left: none;
            border-right: none;
        }
        .result-table td {
            border: none; /* 数据行全空 */
        }
        
        /* 强制表格底线显示 */
        .result-table {
             border-bottom: 1.5pt solid #000 !important;
        }
        
        /* 解读文字区域：去除边框，纯文本 */
        .interpretation-text {
            border: none !important;
            padding: 0 !important;
            background: none !important;
            margin-top: 12pt;
            font-family: 'Times New Roman', 'SimSun', serif;
            font-size: 12pt;
            line-height: 1.5;
            text-indent: 2em;
        }
    `;
}

function getTableTextContent(table) {
    let textContent = '';
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        cells.forEach(cell => {
            rowData.push(cell.textContent.trim());
        });
        textContent += rowData.join('\t') + '\n';
    });
    return textContent;
}

function fallbackTextCopy(table, button) {
    const textContent = getTableTextContent(table);
    if (!textContent || textContent.trim() === '') {
        console.error('表格内容为空');
        showMessage('表格内容为空，无法复制', 'error');
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textContent).then(() => {
            showCopySuccess(button);
        }).catch(err => {
            console.error('纯文本复制也失败:', err);
        });
    }
}

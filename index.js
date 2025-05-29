// public/extensions/third-party/scane/index.js

import {
    extension_settings,
    getContext, // 如果需要使用 context 对象，则导入
    renderExtensionTemplateAsync,
    // loadExtensionSettings // 这个函数通常由 ST 核心调用，插件一般不需要主动导入和调用
} from '../../../extensions.js';

// 从 script.js 导入
import {
    saveSettingsDebounced,
    eventSource,
    event_types, // 如果需要监听事件，则导入
    // 其他可能需要的函数，如 messageFormatting, addOneMessage 等
} from '../../../../script.js';

// 如果你的插件需要弹窗功能，从 popup.js 导入
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// 如果需要 UUID 或时间戳处理等工具函数，从 utils.js 导入
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// 插件的命名空间，与 manifest.json 中的文件夹名称一致
const PLUGIN_ID = 'scane2';
const PLUGIN_NAME = 'ST截图3.0 (dom-to-image)'; // 更新插件名以区分

// 插件的默认设置
const defaultSettings = {
    screenshotDelay: 10,       // 可以设置更低值，比如 0-20
    scrollDelay: 10,
    autoInstallButtons: true,
    altButtonLocation: true,
    screenshotScale: 2.0,      // 降低到 1.0 以提高速度
    useForeignObjectRendering: false, // dom-to-image-more 也支持
    letterRendering: true,    // dom-to-image-more 可能不直接支持，但保留设置
    imageTimeout: 5000,        // dom-to-image-more 支持 imageTimeout
    debugOverlay: true,        // 新增：是否显示进度遮罩层
    cacheBust: true,           // 新增：用于 dom-to-image-more 强制重新加载图片
};

// 全局配置对象，将从设置中加载
const config = {
    buttonClass: 'st-screenshot-button',
    chatScrollContainerSelector: '#chat',
    chatContentSelector: '#chat',
    messageSelector: '.mes',
    lastMessageSelector: '.mes.last_mes',
    messageTextSelector: '.mes_block .mes_text',
    messageHeaderSelector: '.mes_block .ch_name',
    domToImageOptions: { // 重命名
        // bgcolor: null, // 将在临时容器上设置背景色
        // 其他选项会从 settings 加载，不要在这里硬编码
        // dom-to-image-more 的一些默认行为可能覆盖 html2canvas 的某些选项
    }
};

// 确保插件设置已加载并与默认值合并
function getPluginSettings() {
    extension_settings[PLUGIN_ID] = extension_settings[PLUGIN_ID] || {};
    Object.assign(extension_settings[PLUGIN_ID], { ...defaultSettings, ...extension_settings[PLUGIN_ID] });
    return extension_settings[PLUGIN_ID];
}

// 加载并应用配置
function loadConfig() {
    const settings = getPluginSettings();

    // 基本配置
    config.screenshotDelay = parseInt(settings.screenshotDelay, 10) || 0;
    config.scrollDelay = parseInt(settings.scrollDelay, 10) || 0;
    config.autoInstallButtons = settings.autoInstallButtons;
    config.altButtonLocation = settings.altButtonLocation;
    config.debugOverlay = settings.debugOverlay !== undefined ? settings.debugOverlay : true;

    // 将所有 dom-to-image 相关设置正确地应用到 domToImageOptions
    const loadedScale = parseFloat(settings.screenshotScale);
    if (!isNaN(loadedScale) && loadedScale > 0) {
        config.domToImageOptions.scale = loadedScale;
    } else {
        config.domToImageOptions.scale = defaultSettings.screenshotScale;
    }

    config.domToImageOptions.foreignObjectRendering = settings.useForeignObjectRendering; // dom-to-image-more 应该有类似选项，如 useForeignObject
    config.domToImageOptions.imageTimeout = settings.imageTimeout || defaultSettings.imageTimeout;
    config.domToImageOptions.cacheBust = settings.cacheBust !== undefined ? settings.cacheBust : defaultSettings.cacheBust;
    
    // letterRendering 对 dom-to-image-more 的影响未知，但保留设置
    // config.domToImageOptions.letterRendering = settings.letterRendering; // dom-to-image-more 没有直接的 letterRendering

    console.log(`${PLUGIN_NAME}: 配置已加载并应用:`, config);
}

// === 动态加载脚本的辅助函数 (保持在 jQuery 闭包外部) ===
async function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            console.log(`[${PLUGIN_NAME}] 脚本加载成功: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            console.error(`[${PLUGIN_NAME}] 脚本加载失败: ${src}`, error);
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

// SillyTavern 插件入口点
jQuery(async () => {
    console.log(`${PLUGIN_NAME}: 插件初始化中...`);

    // === 动态加载 dom-to-image-more.min.js ===
    try {
        // === 重点修改这里的路径 ===
        // 确保你已经将 dom-to-image-more.min.js 放在此路径
        await loadScript(`scripts/extensions/third-party/${PLUGIN_ID}/dom-to-image-more.min.js`);
        if (typeof domtoimage === 'undefined') {
            throw new Error('domtoimage global object not found after loading script.');
        }
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载 dom-to-image-more.min.js。插件功能将受限。`, error);
        // 可以选择弹窗提示用户
        // alert(`${PLUGIN_NAME}: 核心库 dom-to-image-more.min.js 加载失败，截图功能不可用。请检查文件路径或网络连接。`);
        return;
    }

    // 1. 加载配置（从 extension_settings）
    loadConfig();

    // 2. 注册设置面板
    let settingsHtml;
    try {
        settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_ID}`, 'settings');
        console.log(`${PLUGIN_NAME}: 成功加载设置面板模板`);
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载设置面板模板:`, error);
        settingsHtml = `
        <div id="scane2_settings">
          <h2>${PLUGIN_NAME}</h2>

          <div class="option-group">
            <h3>截图操作</h3>
            <button id="st_h2c_captureLastMsgBtn" class="menu_button">截取最后一条消息</button>
          </div>

          <hr>

          <div class="option-group">
            <h3>扩展设置</h3>
            <div class="option">
              <label for="st_h2c_screenshotDelay">截图前延迟 (ms):</label>
              <input type="number" id="st_h2c_screenshotDelay" min="0" max="2000" step="50" value="${defaultSettings.screenshotDelay}">
            </div>
            <div class="option">
              <label for="st_h2c_scrollDelay">UI更新等待 (ms):</label>
              <input type="number" id="st_h2c_scrollDelay" min="0" max="2000" step="50" value="${defaultSettings.scrollDelay}">
            </div>
            <div class="option">
              <label for="st_h2c_screenshotScale">渲染比例 (Scale):</label>
              <input type="number" id="st_h2c_screenshotScale" min="0.5" max="4.0" step="0.1" value="${defaultSettings.screenshotScale}">
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_useForeignObjectRendering" ${defaultSettings.useForeignObjectRendering ? 'checked' : ''}>
              <label for="st_h2c_useForeignObjectRendering">尝试SVG外国对象渲染 (某些浏览器/内容可能更快)</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_letterRendering" ${defaultSettings.letterRendering ? 'checked' : ''}>
              <label for="st_h2c_letterRendering">字形渲染 (dom-to-image 对此选项处理不同)</label>
            </div>
            <div class="option">
                <label for="st_h2c_imageTimeout">图像加载超时 (ms):</label>
                <input type="number" id="st_h2c_imageTimeout" min="0" max="30000" step="1000" value="${defaultSettings.imageTimeout}">
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_cacheBust" ${defaultSettings.cacheBust ? 'checked' : ''}>
              <label for="st_h2c_cacheBust">清除图片缓存 (用于CORS图片)</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_autoInstallButtons" ${defaultSettings.autoInstallButtons ? 'checked' : ''}>
              <label for="st_h2c_autoInstallButtons">自动安装消息按钮</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_altButtonLocation" ${defaultSettings.altButtonLocation ? 'checked' : ''}>
              <label for="st_h2c_altButtonLocation">按钮备用位置</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_debugOverlay" ${defaultSettings.debugOverlay ? 'checked' : ''}>
              <label for="st_h2c_debugOverlay">显示调试覆盖层</label>
            </div>

            <button id="st_h2c_saveSettingsBtn" class="menu_button">保存设置</button>
            <div class="status-area" id="st_h2c_saveStatus" style="display:none;"></div>
          </div>
        </div>
        `;
    }

    $('#extensions_settings_content').append(settingsHtml);

    // 3. 绑定设置界面元素和事件
    const settingsForm = $('#extensions_settings_content');

    const screenshotDelayEl = settingsForm.find('#st_h2c_screenshotDelay');
    const scrollDelayEl = settingsForm.find('#st_h2c_scrollDelay');
    const screenshotScaleEl = settingsForm.find('#st_h2c_screenshotScale');
    const useForeignObjectRenderingEl = settingsForm.find('#st_h2c_useForeignObjectRendering');
    const autoInstallButtonsEl = settingsForm.find('#st_h2c_autoInstallButtons');
    const altButtonLocationEl = settingsForm.find('#st_h2c_altButtonLocation');
    const saveSettingsBtn = settingsForm.find('#st_h2c_saveSettingsBtn');
    const saveStatusEl = settingsForm.find('#st_h2c_saveStatus');
    const captureLastMsgBtn = settingsForm.find('#st_h2c_captureLastMsgBtn');
    const letterRenderingEl = settingsForm.find('#st_h2c_letterRendering');
    const imageTimeoutEl = settingsForm.find('#st_h2c_imageTimeout'); // 新增
    const cacheBustEl = settingsForm.find('#st_h2c_cacheBust'); // 新增
    const debugOverlayEl = settingsForm.find('#st_h2c_debugOverlay');

    function updateSettingsUI() {
        const settings = getPluginSettings();
        screenshotDelayEl.val(settings.screenshotDelay);
        scrollDelayEl.val(settings.scrollDelay);
        screenshotScaleEl.val(settings.screenshotScale);
        useForeignObjectRenderingEl.prop('checked', settings.useForeignObjectRendering);
        autoInstallButtonsEl.prop('checked', settings.autoInstallButtons);
        altButtonLocationEl.prop('checked', settings.altButtonLocation !== undefined ? settings.altButtonLocation : true);
        
        if (letterRenderingEl) letterRenderingEl.prop('checked', settings.letterRendering);
        if (imageTimeoutEl) imageTimeoutEl.val(settings.imageTimeout);
        if (cacheBustEl) cacheBustEl.prop('checked', settings.cacheBust);
        if (debugOverlayEl) debugOverlayEl.prop('checked', settings.debugOverlay);
    }

    saveSettingsBtn.on('click', () => {
        const settings = getPluginSettings();

        settings.screenshotDelay = parseInt(screenshotDelayEl.val(), 10) || defaultSettings.screenshotDelay;
        settings.scrollDelay = parseInt(scrollDelayEl.val(), 10) || defaultSettings.scrollDelay;
        settings.screenshotScale = parseFloat(screenshotScaleEl.val()) || defaultSettings.screenshotScale;
        settings.useForeignObjectRendering = useForeignObjectRenderingEl.prop('checked');
        settings.autoInstallButtons = autoInstallButtonsEl.prop('checked');
        settings.altButtonLocation = altButtonLocationEl.prop('checked');
        settings.letterRendering = letterRenderingEl.prop('checked');
        settings.imageTimeout = parseInt(imageTimeoutEl.val(), 10) || defaultSettings.imageTimeout;
        settings.cacheBust = cacheBustEl.prop('checked');
        settings.debugOverlay = debugOverlayEl.prop('checked');

        saveSettingsDebounced();
        saveStatusEl.text("设置已保存!").css('color', '#4cb944').show();
        setTimeout(() => saveStatusEl.hide(), 1000);

        loadConfig();
        if (config.autoInstallButtons) {
            installScreenshotButtons();
        } else {
            document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
        }
    });

    captureLastMsgBtn.on('click', async () => {
        const options = { target: 'last', includeHeader: true };
        try {
            const dataUrl = await captureMessageWithOptions(options);
            if (dataUrl) {
                downloadImage(dataUrl, null, options.target);
            } else {
                throw new Error('未能生成截图 (dom-to-image)');
            }
        } catch (error) {
            console.error('从设置面板截图失败 (dom-to-image):', error.stack || error);
            alert(`截图失败: ${error.message || '未知错误'}`);
        }
    });

    updateSettingsUI();

    if (config.autoInstallButtons) {
        installScreenshotButtons();
    } else {
        console.log(`${PLUGIN_NAME}: 自动安装截图按钮已禁用.`);
    }

    console.log(`${PLUGIN_NAME}: 插件初始化完成.`);

    // 创建并添加扩展菜单按钮 (与原脚本相同)
    function addExtensionMenuButton() {
        if (document.querySelector(`#extensionsMenu .fa-camera[data-plugin-id="${PLUGIN_ID}"]`)) {
            return;
        }
        const menuButton = document.createElement('div');
        menuButton.classList.add('fa-solid', 'fa-camera', 'extensionsMenuExtension');
        menuButton.title = PLUGIN_NAME;
        menuButton.setAttribute('data-plugin-id', PLUGIN_ID);
        menuButton.appendChild(document.createTextNode('截图设置'));
        menuButton.addEventListener('click', () => {
            const extensionsMenu = document.getElementById('extensionsMenu');
            if (extensionsMenu) extensionsMenu.style.display = 'none';
            showScreenshotPopup();
        });
        const extensionsMenu = document.getElementById('extensionsMenu');
        if (extensionsMenu) {
            extensionsMenu.appendChild(menuButton);
        }
    }

    // 显示截图功能弹窗 (与原脚本相同, 仅更新插件名和错误信息)
    function showScreenshotPopup() {
        const overlay = document.createElement('div');
        overlay.className = 'st-screenshot-overlay';
        Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: '10000', display: 'flex', justifyContent: 'center', alignItems: 'center' });

        const popup = document.createElement('div');
        popup.className = 'st-screenshot-popup';
        Object.assign(popup.style, { backgroundColor: '#2a2a2a', padding: '20px', borderRadius: '10px', maxWidth: '300px', width: '100%' });

        const options = [
            { id: 'last_msg', icon: 'fa-camera', text: '截取最后一条消息' },
            { id: 'conversation', icon: 'fa-images', text: '截取整个对话' },
            { id: 'settings', icon: 'fa-gear', text: '调整截图设置' }
        ];
        
        options.forEach(option => {
            const btn = document.createElement('div');
            btn.className = 'st-screenshot-option';
            Object.assign(btn.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', margin: '8px 0', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#3a3a3a' }); // Initial bg
            
            btn.innerHTML = `<i class="fa-solid ${option.icon}" style="font-size: 1.2em;"></i><span>${option.text}</span>`;
            
            btn.addEventListener('mouseover', () => btn.style.backgroundColor = '#4a4a4a');
            btn.addEventListener('mouseout', () => btn.style.backgroundColor = '#3a3a3a');
            
            btn.addEventListener('click', async () => {
                console.log(`[${PLUGIN_NAME}] ${option.id} clicked`);
                document.body.removeChild(overlay);
                
                try {
                    switch(option.id) {
                        case 'last_msg':
                            const dataUrl = await captureMessageWithOptions({ target: 'last', includeHeader: true });
                            if (dataUrl) downloadImage(dataUrl, null, 'last_message');
                            break;
                        case 'conversation':
                            const convDataUrl = await captureMessageWithOptions({ target: 'conversation', includeHeader: true });
                            if (convDataUrl) downloadImage(convDataUrl, null, 'conversation');
                            break;
                        case 'settings':
                            showSettingsPopup(); // 这个函数也需要更新
                            break;
                    }
                } catch (error) {
                    console.error(`[${PLUGIN_NAME}] 操作失败:`, error);
                    alert(`操作失败 (dom-to-image): ${error.message || '未知错误'}`);
                }
            });
            popup.appendChild(btn);
        });
        
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    }

    function waitForExtensionsMenu() {
        if (document.getElementById('extensionsMenu')) {
            addExtensionMenuButton();
            return;
        }
        const observer = new MutationObserver((mutations, obs) => {
            if (document.getElementById('extensionsMenu')) {
                addExtensionMenuButton();
                obs.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    waitForExtensionsMenu();
});


// --- 辅助函数：准备单个元素给截图库 (保持与原脚本相似的净化逻辑) ---
// Renamed from prepareSingleElementForHtml2CanvasPro
function prepareSingleElementForCapture(originalElement) {
    if (!originalElement) return null;
    const element = originalElement.cloneNode(true);
    
    element.querySelectorAll('.mes_buttons').forEach(buttonsArea => {
        if (buttonsArea && buttonsArea.parentNode) {
            buttonsArea.parentNode.removeChild(buttonsArea);
        }
    });
    
    const metaSelectors = ['.mesIDDisplay', '.mes_timer', '.tokenCounterDisplay'];
    metaSelectors.forEach(selector => {
        element.querySelectorAll(selector).forEach(metaEl => {
            if (metaEl && metaEl.parentNode) {
                metaEl.parentNode.removeChild(metaEl);
            }
        });
    });

    element.querySelectorAll('script, style, noscript, iframe, canvas').forEach(el => el.remove());
    
    element.querySelectorAll('.mes_reasoning, .mes_reasoning_delete, .mes_reasoning_edit_cancel').forEach(el => {
        if (el && el.style) {
            const style = el.style;
            style.removeProperty('color');
            style.removeProperty('background-color');
            style.removeProperty('border-color');
        }
    });
    return element;
}

// 核心截图函数：使用 dom-to-image-more
// Renamed from captureElementWithHtml2Canvas
async function captureElementWithDomToImage(elementToCapture, dtiUserOptions = {}) {
    console.log('Preparing to capture element with dom-to-image-more:', elementToCapture);
    
    let overlay = null;
    if (config.debugOverlay) {
        overlay = createOverlay('使用 dom-to-image-more 准备截图...');
        document.body.appendChild(overlay);
    }
    
    const elementsToHide = [
        document.querySelector("#top-settings-holder"),
        document.querySelector("#form_sheld"),
        overlay
    ].filter(el => el);
    const originalDisplays = new Map(); // Not strictly needed for dom-to-image filter, but kept for consistency if manual hiding is re-added
    let dataUrl = null;

    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px'; // Off-screen
    tempContainer.style.top = '-9999px';
    tempContainer.style.padding = '10px'; // Padding around the content

    const chatContentEl = document.querySelector(config.chatContentSelector);
    let containerWidth = 'auto';
    if (chatContentEl) {
        containerWidth = chatContentEl.clientWidth + 'px';
    } else if (elementToCapture) {
        containerWidth = elementToCapture.offsetWidth + 'px';
    }
    tempContainer.style.width = containerWidth;

    let chatBgColor = '#1e1e1e'; // Default background
    if (chatContentEl) {
        const chatStyle = window.getComputedStyle(chatContentEl);
        if (chatStyle.backgroundColor && chatStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && chatStyle.backgroundColor !== 'transparent') {
            chatBgColor = chatStyle.backgroundColor;
        } else {
            const bodyBgVar = getComputedStyle(document.body).getPropertyValue('--pcb');
            if (bodyBgVar && bodyBgVar.trim() !== '') {
                chatBgColor = bodyBgVar.trim();
            }
        }
    }
    tempContainer.style.backgroundColor = chatBgColor; // Apply background to the temporary container

    let preparedElement;
    try {
        if (overlay) updateOverlay(overlay, '准备元素结构...', 0.05);
        preparedElement = prepareSingleElementForCapture(elementToCapture);
        if (!preparedElement) throw new Error("Failed to prepare element for capture.");

        tempContainer.appendChild(preparedElement);
        document.body.appendChild(tempContainer);

        if (config.screenshotDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, config.screenshotDelay));
        }

    } catch (e) {
        console.error("Error during element preparation (dom-to-image):", e);
        if (overlay && document.body.contains(overlay)) {
             updateOverlay(overlay, `净化错误: ${e.message.substring(0, 60)}...`, 0);
        }
        if (tempContainer.parentElement === document.body) {
           document.body.removeChild(tempContainer);
        }
        throw e;
    }

    try {
        if (overlay) updateOverlay(overlay, '正在渲染 (dom-to-image)...', 0.3);
        
        const finalDomToImageOptions = { ...config.domToImageOptions, ...dtiUserOptions };
        
        // dom-to-image filter function: return false to exclude node
        finalDomToImageOptions.filter = (node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return true; // Keep non-element nodes

            if (node.id === 'top-settings-holder' || 
                node.id === 'form_sheld' || 
                node.classList.contains('st-capture-overlay')) {
                return false; // Exclude
            }
            
            if (node.classList && 
                node.classList.contains('flex-container') && 
                node.classList.contains('swipeRightBlock') && 
                node.classList.contains('flexFlowColumn') && 
                node.classList.contains('flexNoGap')) {
                return false; // Exclude
            }
            
            try {
                if (node.closest && node.closest('#chat')) {
                    const isEmotionElement = 
                        (node.parentElement && 
                         node.parentElement.parentElement && 
                         node.parentElement.parentElement.matches('div[class*="mes"] > div[class*="mes_block"] > div')) ||
                        node.matches('.expression_box, .expression-container, [data-emotion]') ||
                        (node.querySelector && node.querySelector('.expression_box, .expression-container, [data-emotion]'));
                        
                    if (isEmotionElement) {
                        return false; // Exclude
                    }
                }
            } catch (e) {
                console.debug('Expression element check error (dom-to-image filter):', e);
            }
            
            return true; // Include by default
        };

        console.log('dom-to-image opts:', finalDomToImageOptions);
        
        // Use the temporary container for rendering
        dataUrl = await domtoimage.toPng(tempContainer, finalDomToImageOptions);
        
        if (overlay) updateOverlay(overlay, '生成图像数据...', 0.8);

    } catch (error) {
        console.error('dom-to-image 截图失败:', error.stack || error);
        if (overlay && document.body.contains(overlay)) {
             const errorMsg = error && error.message ? error.message : "未知渲染错误";
             updateOverlay(overlay, `渲染错误 (dom-to-image): ${errorMsg.substring(0, 60)}...`, 0);
        }
        throw error;
    } finally {
        if (tempContainer.parentElement === document.body) {
           document.body.removeChild(tempContainer);
        }
        if (overlay && document.body.contains(overlay)) {
            if (!dataUrl) {
                setTimeout(() => { if(document.body.contains(overlay)) document.body.removeChild(overlay); }, 3000);
            } else {
               updateOverlay(overlay, '截图完成!', 1);
               setTimeout(() => { if(document.body.contains(overlay)) document.body.removeChild(overlay); }, 1200);
            }
        }
    }
    if (!dataUrl) throw new Error("dom-to-image 未能生成图像数据。");
    console.log("DEBUG: dom-to-image capture successful.");
    return dataUrl;
}

// Capture multiple messages using dom-to-image-more
// Renamed from captureMultipleMessagesWithHtml2Canvas
async function captureMultipleMessagesWithDomToImage(messagesToCapture, actionHint, dtiUserOptions = {}) {
    if (!messagesToCapture || messagesToCapture.length === 0) {
        throw new Error("没有提供消息给 captureMultipleMessagesWithDomToImage");
    }
    console.log(`[captureMultipleMessagesWithDomToImage] Capturing ${messagesToCapture.length} messages. Hint: ${actionHint}`);

    const overlay = createOverlay(`组合 ${messagesToCapture.length} 条消息 (dom-to-image)...`);
    document.body.appendChild(overlay);

    let dataUrl = null;
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '-9999px';
    tempContainer.style.padding = '10px';

    const chatContentEl = document.querySelector(config.chatContentSelector);
    let containerWidth = 'auto';
    if (chatContentEl) {
        containerWidth = chatContentEl.clientWidth + 'px';
    } else if (messagesToCapture.length > 0 && messagesToCapture[0].offsetWidth > 0) { // ensure offsetWidth is valid
        containerWidth = messagesToCapture[0].offsetWidth + 'px';
    } else {
        // Fallback width if everything else fails, e.g. from settings or a default
        containerWidth = '800px'; // Example fallback
        console.warn("Could not determine container width for multi-message capture, using fallback.");
    }
    tempContainer.style.width = containerWidth;


    let chatBgColor = '#1e1e1e';
    if(chatContentEl) {
        const chatStyle = window.getComputedStyle(chatContentEl);
        if (chatStyle.backgroundColor && chatStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && chatStyle.backgroundColor !== 'transparent') {
            chatBgColor = chatStyle.backgroundColor;
        } else {
             const bodyBgVar = getComputedStyle(document.body).getPropertyValue('--pcb');
             if (bodyBgVar && bodyBgVar.trim() !== '') {
                 chatBgColor = bodyBgVar.trim();
             }
        }
    }
    tempContainer.style.backgroundColor = chatBgColor;

    updateOverlay(overlay, `准备 ${messagesToCapture.length} 条消息 (dom-to-image)...`, 0.05);
    messagesToCapture.forEach(msg => {
        try {
            const preparedClone = prepareSingleElementForCapture(msg); // Use the renamed preparation function
            if (preparedClone) {
                tempContainer.appendChild(preparedClone);
            } else {
                 console.warn("Skipping null prepared clone for message:", msg);
            }
        } catch (e) {
            console.error("Error preparing message for multi-capture (dom-to-image):", msg, e);
        }
    });
    document.body.appendChild(tempContainer);
    await new Promise(resolve => setTimeout(resolve, config.screenshotDelay)); // Allow render

    try {
        updateOverlay(overlay, '正在渲染 (dom-to-image)…', 0.3);

        const finalDomToImageOptions = { ...config.domToImageOptions, ...dtiUserOptions };
         finalDomToImageOptions.filter = (node) => { // Same filter as single capture
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            if (node.id === 'top-settings-holder' || 
                node.id === 'form_sheld' || 
                node.classList.contains('st-capture-overlay')) {
                return false;
            }
            if (node.classList && 
                node.classList.contains('flex-container') && 
                node.classList.contains('swipeRightBlock') && 
                node.classList.contains('flexFlowColumn') && 
                node.classList.contains('flexNoGap')) {
                return false;
            }
            try {
                if (node.closest && node.closest('#chat')) {
                    const isEmotionElement = 
                        (node.parentElement && 
                         node.parentElement.parentElement && 
                         node.parentElement.parentElement.matches('div[class*="mes"] > div[class*="mes_block"] > div')) ||
                        node.matches('.expression_box, .expression-container, [data-emotion]') ||
                        (node.querySelector && node.querySelector('.expression_box, .expression-container, [data-emotion]'));
                    if (isEmotionElement) return false;
                }
            } catch (e) { console.debug('Expression check error (filter multi):', e); }
            return true;
        };

        console.log("DEBUG: dom-to-image (multiple) options:", finalDomToImageOptions);
        dataUrl = await domtoimage.toPng(tempContainer, finalDomToImageOptions);

        updateOverlay(overlay, '生成图像数据...', 0.8);

    } catch (error) {
        console.error('dom-to-image 多消息截图失败:', error.stack || error);
         if (overlay && document.body.contains(overlay)) {
             const errorMsg = error && error.message ? error.message : "未知渲染错误";
             updateOverlay(overlay, `多消息渲染错误 (dom-to-image): ${errorMsg.substring(0,50)}...`, 0);
        }
        throw error;
    } finally {
        if (tempContainer.parentElement === document.body) {
            document.body.removeChild(tempContainer);
        }
        if (overlay && document.body.contains(overlay)) {
            if (!dataUrl) {
                 setTimeout(() => {if(document.body.contains(overlay)) document.body.removeChild(overlay);}, 3000);
            } else {
                updateOverlay(overlay, '截图完成!', 1);
                setTimeout(() => {if(document.body.contains(overlay)) document.body.removeChild(overlay);}, 1200);
            }
        }
    }
    if (!dataUrl) throw new Error("dom-to-image 未能生成多消息图像数据。");
    console.log("DEBUG: dom-to-image multiple messages capture successful.");
    return dataUrl;
}


// Routes capture requests, now calls dom-to-image functions
async function captureMessageWithOptions(options) {
    const { target, includeHeader } = options;
    console.log('captureMessageWithOptions (dom-to-image) called with:', options);

    const chatContentEl = document.querySelector(config.chatContentSelector);
    if (!chatContentEl) {
         const errorMsg = `聊天内容容器 '${config.chatContentSelector}' 未找到!`;
         console.error(`${PLUGIN_NAME}:`, errorMsg);
         throw new Error(errorMsg);
    }

    let elementToRender;
    let messagesForMultiCapture = [];

    switch (target) {
        case 'last':
            elementToRender = chatContentEl.querySelector(config.lastMessageSelector);
            if (!elementToRender) throw new Error('最后一条消息元素未找到');
            break;
        case 'selected':
            elementToRender = chatContentEl.querySelector(`${config.messageSelector}[data-selected="true"]`) || chatContentEl.querySelector(`${config.messageSelector}.selected`);
            if (!elementToRender) throw new Error('没有选中的消息');
            break;
        case 'conversation':
            messagesForMultiCapture = Array.from(chatContentEl.querySelectorAll(config.messageSelector));
            if (messagesForMultiCapture.length === 0) throw new Error("对话中没有消息可捕获。");
            return await captureMultipleMessagesWithDomToImage(messagesForMultiCapture, "conversation_all", {}); // Updated call
        default:
            throw new Error('未知的截图目标类型');
    }

    if (!elementToRender && messagesForMultiCapture.length === 0) {
         throw new Error(`目标元素未找到 (for ${target} within ${config.chatContentSelector})`);
    }

    if (elementToRender) {
        let finalElementToCapture = elementToRender;
        if (!includeHeader && target !== 'conversation' && elementToRender.querySelector(config.messageTextSelector)) {
            const textElement = elementToRender.querySelector(config.messageTextSelector);
            if (textElement) {
                finalElementToCapture = textElement;
                console.log('Capturing text element only with dom-to-image:', finalElementToCapture);
            } else {
                console.warn("Could not find text element for includeHeader: false, capturing full message.");
            }
        }
        return await captureElementWithDomToImage(finalElementToCapture, {}); // Updated call
    }
    throw new Error("captureMessageWithOptions (dom-to-image): Unhandled capture scenario.");
}

// Installs screenshot buttons (largely same, just updates error messages/logs if any)
function installScreenshotButtons() {
    document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());

    const chatContentEl = document.querySelector(config.chatContentSelector);
    if (chatContentEl) {
        chatContentEl.querySelectorAll(config.messageSelector).forEach(message => addScreenshotButtonToMessage(message));
    } else {
        console.warn(`${PLUGIN_NAME}: Chat content ('${config.chatContentSelector}') not found for initial button installation.`);
        return false;
    }

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(config.messageSelector)) {
                addScreenshotButtonToMessage(node);
              } else if (node.querySelectorAll) {
                node.querySelectorAll(config.messageSelector).forEach(addScreenshotButtonToMessage);
              }
            }
          });
        }
      });
    });

    observer.observe(chatContentEl, { childList: true, subtree: true });
    console.log(`${PLUGIN_NAME}: 截图按钮安装逻辑已执行.`);
    return true;
}

// Adds a screenshot button (updated calls in click handler)
function addScreenshotButtonToMessage(messageElement) {
    if (!messageElement || !messageElement.querySelector || messageElement.querySelector(`.${config.buttonClass}`)) {
      return;
    }

    let buttonsContainer = messageElement.querySelector('.mes_block .ch_name.flex-container.justifySpaceBetween .mes_buttons');
    if (!buttonsContainer) {
      buttonsContainer = messageElement.querySelector('.mes_block .mes_buttons');
      if (!buttonsContainer) {
        return;
      }
    }

    const screenshotButton = document.createElement('div');
    screenshotButton.innerHTML = '<i class="fa-solid fa-camera"></i>';
    screenshotButton.className = `${config.buttonClass} mes_button interactable`; 
    screenshotButton.title = '截图此消息 (长按显示更多选项)';
    screenshotButton.setAttribute('tabindex', '0');
    screenshotButton.style.cursor = 'pointer';

    const contextMenu = document.createElement('div');
    contextMenu.className = 'st-screenshot-context-menu';
    Object.assign(contextMenu.style, { display: 'none', position: 'absolute', zIndex: '10000', background: '#2a2a2a', border: '1px solid #555', borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', padding: '5px 0' });

    const menuOptions = [
      { text: '截取前四条消息', action: 'prev4' }, { text: '截取前三条消息', action: 'prev3' },
      { text: '截取前两条消息', action: 'prev2' }, { text: '截取前一条消息', action: 'prev1' },
      { text: '截取后一条消息', action: 'next1' }, { text: '截取后两条消息', action: 'next2' },
      { text: '截取后三条消息', action: 'next3' }, { text: '截取后四条消息', action: 'next4' }
    ];

    menuOptions.forEach(option => {
      const menuItem = document.createElement('div');
      menuItem.className = 'st-screenshot-menu-item';
      menuItem.textContent = option.text;
      Object.assign(menuItem.style, { padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background-color 0.2s' });
      menuItem.onmouseover = () => menuItem.style.backgroundColor = '#3a3a3a';
      menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';
      menuItem.onclick = async (e) => {
        e.stopPropagation(); 
        hideContextMenu();
        await captureMultipleMessagesFromContextMenu(messageElement, option.action); // Calls the updated multi-capture
      };
      contextMenu.appendChild(menuItem);
    });
    document.body.appendChild(contextMenu);

    let pressTimer, isLongPress = false;
    function showContextMenu(x, y) {
      contextMenu.style.display = 'block';
      const vpW = window.innerWidth, vpH = window.innerHeight;
      const menuW = contextMenu.offsetWidth, menuH = contextMenu.offsetHeight;
      if (x + menuW > vpW) x = vpW - menuW - 5;
      if (y + menuH > vpH) y = vpH - menuH - 5;
      if (y < 0) y = 5;
      contextMenu.style.left = `${x}px`; contextMenu.style.top = `${y}px`;
    }
    function hideContextMenu() { contextMenu.style.display = 'none'; }

    screenshotButton.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true; const rect = screenshotButton.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 5);
      }, 500);
    });
    screenshotButton.addEventListener('mouseup', () => clearTimeout(pressTimer));
    screenshotButton.addEventListener('mouseleave', () => clearTimeout(pressTimer));
    screenshotButton.addEventListener('touchstart', (e) => {
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true; const rect = screenshotButton.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 5);
      }, 500);
    });
    screenshotButton.addEventListener('touchend', () => clearTimeout(pressTimer));
    screenshotButton.addEventListener('touchcancel', () => clearTimeout(pressTimer));
    document.addEventListener('click', (e) => {
      if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target) && !screenshotButton.contains(e.target)) {
          hideContextMenu();
      }
    });
    screenshotButton.addEventListener('contextmenu', (e) => e.preventDefault());

    screenshotButton.addEventListener('click', async function(event) {
      event.preventDefault(); event.stopPropagation();
      if (isLongPress) { isLongPress = false; return; }
      if (this.classList.contains('loading')) return;

      const iconElement = this.querySelector('i');
      const originalIconClass = iconElement ? iconElement.className : '';
      if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;
      this.classList.add('loading');

      try {
        const dataUrl = await captureElementWithDomToImage(messageElement, {}); // Updated call
        downloadImage(dataUrl, messageElement, 'message');
      } catch (error) {
        console.error('消息截图失败 (dom-to-image button click):', error.stack || error);
        alert(`截图失败: ${error.message || '未知错误'}`);
      } finally {
        if (iconElement) iconElement.className = originalIconClass;
        this.classList.remove('loading');
      }
    });

    const extraMesButtons = buttonsContainer.querySelector('.extraMesButtons.visible');
    const editButton = buttonsContainer.querySelector('.mes_button.mes_edit.fa-solid.fa-pencil.interactable');
    if (extraMesButtons && editButton) {
      editButton.insertAdjacentElement('beforebegin', screenshotButton);
    } else {
      const existingButton = buttonsContainer.querySelector('.fa-edit, .mes_edit');
      if (existingButton) {
        existingButton.insertAdjacentElement('beforebegin', screenshotButton);
      } else {
        buttonsContainer.appendChild(screenshotButton);
      }
    }
}

// Handles context menu actions (updated calls)
async function captureMultipleMessagesFromContextMenu(currentMessageElement, action) {
    console.log(`[多消息截图 ctx menu dom-to-image] Action: ${action} from msg:`, currentMessageElement);
    const button = currentMessageElement.querySelector(`.${config.buttonClass}`);
    const iconElement = button ? button.querySelector('i') : null;
    const originalIconClass = iconElement ? iconElement.className : '';

    if (button) button.classList.add('loading');
    if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;

    try {
        const chatContent = document.querySelector(config.chatContentSelector);
        if (!chatContent) throw new Error(`无法进行多消息截图，聊天内容容器 '${config.chatContentSelector}' 未找到!`);
        
        let allMessages = Array.from(chatContent.querySelectorAll(config.messageSelector));
        let currentIndex = allMessages.indexOf(currentMessageElement);
        if (currentIndex === -1) throw new Error('无法确定当前消息位置');

        let startIndex = currentIndex, endIndex = currentIndex;
        switch (action) {
            case 'prev4': startIndex = Math.max(0, currentIndex - 4); break;
            case 'prev3': startIndex = Math.max(0, currentIndex - 3); break;
            case 'prev2': startIndex = Math.max(0, currentIndex - 2); break;
            case 'prev1': startIndex = Math.max(0, currentIndex - 1); break;
            case 'next1': endIndex = Math.min(allMessages.length - 1, currentIndex + 1); break;
            case 'next2': endIndex = Math.min(allMessages.length - 1, currentIndex + 2); break;
            case 'next3': endIndex = Math.min(allMessages.length - 1, currentIndex + 3); break;
            case 'next4': endIndex = Math.min(allMessages.length - 1, currentIndex + 4); break;
            default: throw new Error(`未知多消息截图动作: ${action}`);
        }

        const targetMessages = allMessages.slice(startIndex, endIndex + 1);
        if (targetMessages.length === 0) throw new Error('无法获取目标消息进行多条截图');

        const dataUrl = await captureMultipleMessagesWithDomToImage(targetMessages, action, {}); // Updated call

        if (dataUrl) {
            const actionTextMap = { 'prev4':'前四条', 'prev3':'前三条', 'prev2':'前两条', 'prev1':'前一条', 'next1':'后一条', 'next2':'后两条', 'next3':'后三条', 'next4':'后四条' };
            const fileNameHint = `ST消息组_${actionTextMap[action] || action}`;
            downloadImage(dataUrl, currentMessageElement, fileNameHint);
        } else {
            throw new Error('多消息截图 dom-to-image 生成失败');
        }
    } catch (error) {
        console.error(`[多消息截图 ctx menu dom-to-image] 失败 (${action}):`, error.stack || error);
        alert(`截图 (${action}) 失败: ${error.message || '未知错误'}`);
    } finally {
        if (iconElement) iconElement.className = originalIconClass;
        if (button) button.classList.remove('loading');
    }
}


// Utility function to download (same as original)
function downloadImage(dataUrl, messageElement = null, typeHint = 'screenshot') {
    const link = document.createElement('a');
    let filename = `SillyTavern_${typeHint.replace(/[^a-z0-9_-]/gi, '_')}`;
    if (messageElement && typeof messageElement.querySelector === 'function') {
      const nameSelector = config.messageHeaderSelector + ' .name_text';
      const nameFallbackSelector = config.messageHeaderSelector;
      const nameTextElement = messageElement.querySelector(nameSelector) || messageElement.querySelector(nameFallbackSelector);
      let senderName = 'Character';
      if (nameTextElement && nameTextElement.textContent) {
          senderName = nameTextElement.textContent.trim() || 'Character';
      }
      const isUser = messageElement.classList.contains('user_mes') || (messageElement.closest && messageElement.closest('.user_mes'));
      const sender = isUser ? 'User' : senderName;
      const msgIdData = messageElement.getAttribute('mesid') || messageElement.dataset.msgId || messageElement.id;
      const msgId = msgIdData ? msgIdData.slice(-5) : ('m' + Date.now().toString().slice(-8, -4));
      const timestampAttr = messageElement.dataset.timestamp || messageElement.getAttribute('data-timestamp') || new Date().toISOString();
      const timestamp = timestampAttr.replace(/[:\sTZ.]/g, '_').replace(/__+/g, '_');
      const filenameSafeSender = sender.replace(/[^a-z0-9_-]/gi, '_').substring(0, 20);
      filename = `SillyTavern_${filenameSafeSender}_${msgId}_${timestamp}`;
    } else {
      filename += `_${new Date().toISOString().replace(/[:.TZ]/g, '-')}`;
    }
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
    console.log(`Image downloaded as ${filename}.png`);
}

// Utility to create overlay (same as original)
function createOverlay(message) {
    const overlay = document.createElement('div');
    overlay.className = 'st-capture-overlay';
    const statusBox = document.createElement('div');
    statusBox.className = 'st-capture-status';
    const messageP = document.createElement('p');
    messageP.textContent = message;
    statusBox.appendChild(messageP);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'st-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'st-progress-bar';
    progressBar.style.width = '0%';
    progressContainer.appendChild(progressBar);
    statusBox.appendChild(progressContainer);
    overlay.appendChild(statusBox);
    return overlay;
}

// Utility to update overlay (same as original)
function updateOverlay(overlay, message, progressRatio) {
    if (!overlay || !overlay.parentNode) return;
    const messageP = overlay.querySelector('.st-capture-status p');
    const progressBar = overlay.querySelector('.st-progress-bar');
    if (messageP) messageP.textContent = message;
    const safeProgress = Math.max(0, Math.min(1, progressRatio));
    if (progressBar) progressBar.style.width = `${Math.round(safeProgress * 100)}%`;
}

// 自定义设置弹窗 (与原脚本类似，更新了部分标签和选项)
function showSettingsPopup() {
    const settings = getPluginSettings();
    
    const overlay = document.createElement('div');
    overlay.className = 'st-settings-overlay';
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: '10000', display: 'flex', justifyContent: 'center', alignItems: 'center' });

    const popup = document.createElement('div');
    popup.className = 'st-settings-popup';
    Object.assign(popup.style, { backgroundColor: '#2a2a2a', padding: '20px', borderRadius: '10px', maxWidth: '400px', width: '100%', maxHeight: '80vh', overflowY: 'auto', position: 'absolute', cursor: 'move' });
    
    const title = document.createElement('h3');
    title.textContent = '截图设置 (dom-to-image)';
    Object.assign(title.style, { marginTop: '0', marginBottom: '15px', textAlign: 'center' });
    popup.appendChild(title);
    
    const settingsConfig = [
        { id: 'screenshotDelay', type: 'number', label: '截图前延迟 (ms)', min: 0, max: 2000, step: 50 },
        { id: 'scrollDelay', type: 'number', label: 'UI更新等待 (ms)', min: 0, max: 2000, step: 50 },
        { id: 'screenshotScale', type: 'number', label: '渲染比例 (Scale)', min: 0.5, max: 4.0, step: 0.1 },
        { id: 'useForeignObjectRendering', type: 'checkbox', label: '尝试SVG外国对象渲染' },
        { id: 'letterRendering', type: 'checkbox', label: '字形渲染 (效果依库而定)' },
        { id: 'imageTimeout', type: 'number', label: '图像加载超时 (ms)', min: 0, max: 30000, step: 1000 },
        { id: 'cacheBust', type: 'checkbox', label: '清除图片缓存' },
        { id: 'autoInstallButtons', type: 'checkbox', label: '自动安装消息按钮' },
        { id: 'altButtonLocation', type: 'checkbox', label: '按钮备用位置' },
        { id: 'debugOverlay', type: 'checkbox', label: '显示调试覆盖层' }
    ];
    
    settingsConfig.forEach(setting => {
        const settingContainer = document.createElement('div');
        Object.assign(settingContainer.style, { margin: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        
        const label = document.createElement('label');
        label.textContent = setting.label;
        label.style.marginRight = '10px';
        settingContainer.appendChild(label);
        
        let input;
        if (setting.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `st_setting_popup_${setting.id}`; // Ensure unique IDs for popup
            input.checked = settings[setting.id];
        } else if (setting.type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.id = `st_setting_popup_${setting.id}`;
            input.min = setting.min;
            input.max = setting.max;
            input.step = setting.step;
            input.value = settings[setting.id];
            input.style.width = '80px';
        }
        
        settingContainer.appendChild(input);
        popup.appendChild(settingContainer);
    });
    
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, { display: 'flex', justifyContent: 'center', marginTop: '20px' });
    
    const saveButton = document.createElement('button');
    saveButton.textContent = '保存设置';
    Object.assign(saveButton.style, { padding: '8px 16px', borderRadius: '4px', backgroundColor: '#4dabf7', border: 'none', color: 'white', cursor: 'pointer' });
    
    saveButton.addEventListener('click', () => {
        const currentSettings = getPluginSettings(); // Use currentSettings to avoid confusion with global `settings`
        
        settingsConfig.forEach(setting => {
            const input = document.getElementById(`st_setting_popup_${setting.id}`);
            if (setting.type === 'checkbox') {
                currentSettings[setting.id] = input.checked;
            } else if (setting.type === 'number') {
                currentSettings[setting.id] = parseFloat(input.value);
                if (isNaN(currentSettings[setting.id])) {
                    currentSettings[setting.id] = defaultSettings[setting.id]; // Fallback to default
                }
            }
        });
        
        saveSettingsDebounced();
        loadConfig(); 
        
        const statusMsg = document.createElement('div');
        statusMsg.textContent = '设置已保存！';
        Object.assign(statusMsg.style, { color: '#4cb944', textAlign: 'center', marginTop: '10px' });
        // Append status after save button, or replace save button content temporarily
        if (!buttonContainer.querySelector('.status-message')) { // Prevent multiple status messages
            statusMsg.className = 'status-message';
            buttonContainer.appendChild(statusMsg);
        }


        // Update main settings UI if it's visible/exists
        updateSettingsUI(); 
        
        setTimeout(() => {
            document.body.removeChild(overlay);
            if (currentSettings.autoInstallButtons) {
                document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
                installScreenshotButtons();
            } else {
                document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
            }
        }, 1500);
    });
    
    buttonContainer.appendChild(saveButton);
    popup.appendChild(buttonContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    let isDragging = false, offsetX = 0, offsetY = 0;
    popup.addEventListener('mousedown', (e) => { isDragging = true; offsetX = e.clientX - popup.getBoundingClientRect().left; offsetY = e.clientY - popup.getBoundingClientRect().top; });
    popup.addEventListener('touchstart', (e) => { isDragging = true; offsetX = e.touches[0].clientX - popup.getBoundingClientRect().left; offsetY = e.touches[0].clientY - popup.getBoundingClientRect().top; }, {passive: false});
    document.addEventListener('mousemove', (e) => { if (!isDragging) return; const x = e.clientX - offsetX; const y = e.clientY - offsetY; popup.style.left = `${x}px`; popup.style.top = `${y}px`; });
    document.addEventListener('touchmove', (e) => { if (!isDragging) return; const x = e.touches[0].clientX - offsetX; const y = e.touches[0].clientY - offsetY; popup.style.left = `${x}px`; popup.style.top = `${y}px`; e.preventDefault(); }, {passive: false});
    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('touchend', () => isDragging = false);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
}
// 主装配与逻辑控制层：协调数据库、UI初始化、Modal弹窗和文件拖拽导入
window.HRApp = (function () {
    
    async function init() {
        try {
            // 1. 初始化 IndexedDB
            await window.HRStorage.initDb();
            
            // 2. 写入默认演示图书（如果为空）
            await window.HRStorage.checkAndBootstrap();

            // 3. 初始化 UI 模块和导航
            window.HRUi.init();
            window.HRUi.bindNav();

            // 4. 显示图书库视图
            window.HRUi.setLibraryView();

            // 5. 绑定 Modal 弹窗触发
            bindModals();

            // 6. 绑定拖拽上传事件
            bindDragAndDrop();

            // 7. 检查上次是否有没有读完的书，自动重新载入
            resumeLastRead();

            console.log("[app] HiRead 初始化完成！");
        } catch (e) {
            console.error("[app] 初始化失败:", e);
            window.HRUi.showToast("应用初始化失败，请刷新重试", "error");
        }
    }

    // 绑定弹窗控制
    function bindModals() {
        const importBtn = document.querySelector('[data-action="import"]');
        const importModal = document.getElementById("importModal");

        // 打开导入弹窗
        importBtn.addEventListener("click", () => {
            importModal.classList.add("show");
        });

        // 绑定所有关闭按钮
        document.querySelectorAll(".modal-mask").forEach(mask => {
            mask.querySelectorAll("[data-close]").forEach(closeBtn => {
                closeBtn.addEventListener("click", () => {
                    mask.classList.remove("show");
                });
            });
            mask.addEventListener("click", (e) => {
                if (e.target === mask) mask.classList.remove("show");
            });
        });

        // 绑定本地上传选择文件
        const fileInput = document.getElementById("fileInput");
        const uploadZone = document.getElementById("uploadZone");
        
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) handleFileImport(file);
        });

        uploadZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadZone.classList.add("dragover");
        });

        uploadZone.addEventListener("dragleave", () => {
            uploadZone.classList.remove("dragover");
        });

        uploadZone.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadZone.classList.remove("dragover");
            const file = e.dataTransfer.files[0];
            if (file) handleFileImport(file);
        });

    }

    // 处理本地文件上传与解析
    async function handleFileImport(file) {
        const modal = document.getElementById("importModal");
        const filename = file.name;
        const extension = filename.split(".").pop().toLowerCase();

        window.HRUi.showToast("正在解析并导入本地文件...", "info");

        try {
            let parsedBook = null;

            if (extension === "txt") {
                // 读取纯文本
                const text = await readFileAsText(file);
                parsedBook = window.HRParser.parseTXT(filename, text);
            } else if (extension === "epub") {
                // 读取二进制并传入解析器
                parsedBook = await window.HRParser.parseEPUB(file);
            } else {
                window.HRUi.showToast("仅支持导入 .txt 或 .epub 格式文件", "error");
                return;
            }

            // 保存到数据库
            await window.HRStorage.saveBook(parsedBook);
            
            window.HRUi.showToast(`导入书籍成功:《${parsedBook.title}》`, "success");
            
            // 关闭模态框
            modal.classList.remove("show");

            // 刷新列表并打开该书
            window.HRUi.setLibraryView();
            window.HRUi.selectAndOpenBook(parsedBook.id);
        } catch (e) {
            console.error(e);
            window.HRUi.showToast(`文件导入失败: ${e.message}`, "error");
        }
    }

    // 辅助：用 Reader 读取大文本
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error("文件读取失败"));
            reader.readAsText(file, "UTF-8"); // 兜底 UTF-8 编码
        });
    }

    // 绑定全局拖拽导入
    function bindDragAndDrop() {
        window.addEventListener("dragover", (e) => e.preventDefault());
        window.addEventListener("drop", (e) => {
            // 如果是在 Modal 外面 Drop，也直接弹窗并导入
            const isInsideUpload = e.target.closest("#uploadZone");
            if (!isInsideUpload && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                const ext = file.name.split(".").pop().toLowerCase();
                if (ext === "txt" || ext === "epub") {
                    document.getElementById("importModal").classList.add("show");
                    handleFileImport(file);
                }
            }
        });
    }

    // 自动恢复历史阅读
    async function resumeLastRead() {
        const state = window.HRStorage.readState();
        if (state.currentBookId) {
            const list = await window.HRStorage.listBooks();
            const exists = list.some(b => b.id === state.currentBookId);
            if (exists) {
                // 加载并恢复上次阅读
                window.HRUi.selectAndOpenBook(state.currentBookId);
            }
        }
    }

    // 绑定 DOM 载入事件
    document.addEventListener("DOMContentLoaded", init);
    if (document.readyState !== "loading") init();

    return {
        init
    };
})();

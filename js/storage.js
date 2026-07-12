// 本地存储层：用 IndexedDB 存大体积的图书内容，用 localStorage 存进度和轻量配置
window.HRStorage = (function () {
    const DB_NAME = "HiReadDB";
    const DB_VERSION = 1;
    const STORE_NAME = "books";
    const STORAGE_KEY = window.HRConfig.STORAGE_KEY;

    let dbInstance = null;

    // 默认配置
    const defaultState = () => ({
        favorites: [],          // bookId 数组
        history: [],            // [{ bookId, title, author, chapterIdx, percent, at }]
        bookmarks: [],          // [{ id, bookId, chapterIdx, chapterTitle, percent, selectedText, at }]
        settings: {
            fontSize: 18,       // 默认 18px
            lineFactor: 1.8,    // 默认 1.8倍行高
            mode: "scroll",     // 'scroll' (滚动) 或 'page' (翻页)
            fontFamily: "serif", // 'serif' (宋体/衬线) 或 'sans-serif' (黑体/无衬线)
            readerWidth: 80     // 默认全屏宽度百分比 80%
        },
        currentBookId: null,
        currentChapterIdx: 0,
        currentScrollPercent: 0
    });

    // 初始化 IndexedDB
    function initDb() {
        return new Promise((resolve, reject) => {
            if (dbInstance) return resolve(dbInstance);

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
            };

            request.onsuccess = function (e) {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };

            request.onerror = function (e) {
                console.error("IndexedDB 初始化错误:", e);
                reject(e);
            };
        });
    }

    // 从 IndexedDB 保存图书
    async function saveBook(book) {
        const db = await initDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(book);

            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e);
        });
    }

    // 从 IndexedDB 读取单本图书
    async function loadBook(id) {
        const db = await initDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e);
        });
    }

    // 从 IndexedDB 删除图书
    async function deleteBook(id) {
        const db = await initDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);

            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e);
        });
    }

    // 从 IndexedDB 获取所有图书列表（不含全文以优化内存，但我们库很小可以直接获取）
    async function listBooks() {
        const db = await initDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                // 返回图书的元数据，不包含过长的 content 以提高性能
                const books = req.result.map(b => ({
                    id: b.id,
                    title: b.title,
                    author: b.author,
                    category: b.category,
                    coverText: b.coverText || b.title.slice(0, 4),
                    description: b.description || "",
                    format: b.format
                }));
                resolve(books);
            };
            req.onerror = (e) => reject(e);
        });
    }

    // 初始化默认图书写入 IndexedDB (第一次启动时)
    async function checkAndBootstrap() {
        // 清理历史遗存的内置示例图书
        await deleteBook("book-daodejing");
        await deleteBook("book-chaohuaxishi");

        const list = await listBooks();
        if (list.length === 0) {
            console.log("[storage] 首次启动，载入内置演示图书...");
            for (const book of window.HRConfig.DEFAULT_BOOKS) {
                const parsed = window.HRParser.parseTXT(book.title + ".txt", book.content);
                parsed.id = book.id;
                parsed.author = book.author;
                parsed.category = book.category;
                parsed.description = book.description;
                await saveBook(parsed);
            }
        }
    }

    // 读取 localStorage 的轻量状态
    function readState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const base = defaultState();
            if (!raw) return base;
            const parsed = JSON.parse(raw);
            return {
                ...base,
                ...parsed,
                settings: { ...base.settings, ...(parsed.settings || {}) }
            };
        } catch (e) {
            console.warn("[storage] readState failed:", e);
            return defaultState();
        }
    }

    // 写入 localStorage 轻量状态
    function writeState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("[storage] writeState failed:", e);
        }
    }

    // 收藏/取消收藏
    function toggleFavorite(bookId) {
        const state = readState();
        if (state.favorites.includes(bookId)) {
            state.favorites = state.favorites.filter(id => id !== bookId);
        } else {
            state.favorites.push(bookId);
        }
        writeState(state);
        return state.favorites.includes(bookId);
    }

    function isFavorite(bookId) {
        return readState().favorites.includes(bookId);
    }

    // 更新阅读历史
    function pushHistory(bookId, title, author, chapterIdx = 0, percent = 0) {
        const state = readState();
        const entry = {
            bookId,
            title,
            author,
            chapterIdx,
            percent: Math.round(percent),
            at: Date.now()
        };
        // 去重，放到顶部
        state.history = [entry, ...state.history.filter(h => h.bookId !== bookId)].slice(0, 50);
        writeState(state);
    }

    return {
        initDb,
        saveBook,
        loadBook,
        deleteBook,
        listBooks,
        checkAndBootstrap,
        readState,
        writeState,
        toggleFavorite,
        isFavorite,
        pushHistory
    };
})();

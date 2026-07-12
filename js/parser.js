// 电子书解析层：处理 TXT 和 EPUB (配合 JSZip) 文件的解析与章节切分
window.HRParser = (function () {

    // 智能切分 TXT 并提取章节
    function parseTXT(filename, text) {
        const lines = text.split(/\r?\n/);
        const title = filename.replace(/\.txt$/i, "");
        const chapters = [];
        let currentChapterTitle = "前言";
        let currentChapterLines = [];

        // 匹配章节标题的正则表达式
        // 例如：第一章 章节名称、Chapter 1, 1. 第一回 等
        const chapterPattern = /^\s*(第[一二三四五六七八九十百千万零\d]+[章节回集卷]|Chapter\s+\d+|^\s*\d+[\s\.、])\s*(.*)$/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(chapterPattern);

            if (match) {
                // 发现新章节，保存上一章节
                if (currentChapterLines.length > 0 || currentChapterTitle !== "前言") {
                    chapters.push({
                        title: currentChapterTitle,
                        content: formatParagraphs(currentChapterLines)
                    });
                }
                currentChapterTitle = line.trim();
                currentChapterLines = [];
            } else {
                currentChapterLines.push(line);
            }
        }

        // 压入最后一章
        if (currentChapterLines.length > 0 || chapters.length === 0) {
            chapters.push({
                title: currentChapterTitle,
                content: formatParagraphs(currentChapterLines)
            });
        }

        // 如果整本书完全没有切分出章节目录（全部在前言中），则按长度强制切分
        if (chapters.length === 1 && chapters[0].title === "前言" && text.length > 10000) {
            return sliceTextIntoParts(title, text);
        }

        return {
            id: "book-local-" + Date.now().toString(36),
            title: title,
            author: "本地导入",
            category: "local",
            coverText: title.slice(0, 4),
            description: `自本地导入的 TXT 文档，共 ${chapters.length} 章节，约 ${(text.length / 10000).toFixed(1)} 万字。`,
            format: "txt",
            chapters: chapters
        };
    }

    // 格式化段落，转换为带 <p> 标签的 HTML
    function formatParagraphs(lines) {
        return lines
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => `<p>${line}</p>`)
            .join("");
    }

    // 没有章节标识时的强制切分
    function sliceTextIntoParts(title, text) {
        const chapters = [];
        const chunkSize = 6000; // 每 6000 字一章
        let pos = 0;
        let index = 1;

        while (pos < text.length) {
            const end = Math.min(pos + chunkSize, text.length);
            const content = text.slice(pos, end);
            const lines = content.split(/\r?\n/);
            chapters.push({
                title: `第 ${index} 部分`,
                content: formatParagraphs(lines)
            });
            pos = end;
            index++;
        }

        return {
            id: "book-local-" + Date.now().toString(36),
            title: title,
            author: "本地导入",
            category: "local",
            coverText: title.slice(0, 4),
            description: `自本地导入的无目录 TXT，智能切分为 ${chapters.length} 部分。`,
            format: "txt",
            chapters: chapters
        };
    }

    // 客户端解析 EPUB (使用 JSZip 读取 ZIP 包)
    async function parseEPUB(file) {
        if (typeof JSZip === "undefined") {
            throw new Error("JSZip 库未加载，无法解析 EPUB 格式！");
        }

        const zip = await JSZip.loadAsync(file);

        // 1. 获取 container.xml 查找 OPF 路径
        const containerXml = await zip.file("META-INF/container.xml").async("text");
        const domParser = new DOMParser();
        const containerDoc = domParser.parseFromString(containerXml, "application/xml");
        const rootfile = containerDoc.querySelector("rootfile");
        if (!rootfile) throw new Error("无效的 EPUB 格式：找不到 rootfile！");
        
        const opfPath = rootfile.getAttribute("full-path");
        const baseDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

        // 2. 读取并解析 OPF 配置文件
        const opfText = await zip.file(opfPath).async("text");
        const opfDoc = domParser.parseFromString(opfText, "application/xml");

        // 元数据
        const title = opfDoc.querySelector("metadata > dc\\:title, metadata > title")?.textContent?.trim() || file.name.replace(/\.epub$/i, "");
        const author = opfDoc.querySelector("metadata > dc\\:creator, metadata > creator")?.textContent?.trim() || "未知作者";
        const description = opfDoc.querySelector("metadata > dc\\:description, metadata > description")?.textContent?.trim() || "暂无书籍简介。";

        // 3. 构建清单资源列表 (Manifest)
        const manifest = {};
        opfDoc.querySelectorAll("manifest > item").forEach(item => {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            const mediaType = item.getAttribute("media-type");
            
            // 将相对路径规范化，防止 ../ 等问题
            const fullHref = resolveRelativePath(baseDir + href);
            manifest[id] = { href: fullHref, mediaType };
        });

        // 4. 读取图片并替换为 Base64 以保证正常显示
        const imageMap = {};
        for (const id in manifest) {
            const item = manifest[id];
            if (item.mediaType && item.mediaType.startsWith("image/")) {
                try {
                    const zipFile = zip.file(item.href);
                    if (zipFile) {
                        const base64 = await zipFile.async("base64");
                        imageMap[item.href] = `data:${item.mediaType};base64,${base64}`;
                    }
                } catch (err) {
                    console.warn(`[parser] 读取图片失败: ${item.href}`, err);
                }
            }
        }

        // 5. 按照 Spine 顺序读取文本内容并拼装章节
        const spine = Array.from(opfDoc.querySelectorAll("spine > itemref")).map(ref => ref.getAttribute("idref"));
        const chapters = [];

        for (let i = 0; i < spine.length; i++) {
            const idref = spine[i];
            const item = manifest[idref];
            if (!item) continue;

            try {
                const zipFile = zip.file(item.href);
                if (!zipFile) continue;

                let htmlText = await zipFile.async("text");
                const htmlDoc = domParser.parseFromString(htmlText, "text/html");

                // 移除不需要的 head，仅保留 body 内容，做安全清洗和图片 src 替换
                const body = htmlDoc.body;
                if (!body) continue;

                // 替换图片路径
                body.querySelectorAll("img, image").forEach(img => {
                    let src = img.getAttribute("src") || img.getAttribute("xlink:href");
                    if (src) {
                        // 尝试计算图片的绝对路径并替换为 base64
                        const imgFullHref = resolveRelativePath(getDirOfPath(item.href) + src);
                        if (imageMap[imgFullHref]) {
                            img.setAttribute("src", imageMap[imgFullHref]);
                            img.removeAttribute("xlink:href");
                            img.style.maxWidth = "100%";
                            img.style.height = "auto";
                        }
                    }
                });

                // 获取章节标题
                let chapterTitle = htmlDoc.querySelector("h1, h2, h3, title")?.textContent?.trim() || `第 ${chapters.length + 1} 章`;
                if (chapterTitle.length > 50) {
                    chapterTitle = chapterTitle.substring(0, 47) + "...";
                }

                // 提取清洗后的 HTML 内容
                const cleanContent = body.innerHTML;

                chapters.push({
                    title: chapterTitle,
                    content: cleanContent
                });
            } catch (err) {
                console.error(`[parser] 解析章节失败: ${item.href}`, err);
            }
        }

        return {
            id: "book-local-" + Date.now().toString(36),
            title: title,
            author: author,
            category: "local",
            coverText: title.slice(0, 4),
            description: description,
            format: "epub",
            chapters: chapters
        };
    }

    // 辅助工具：计算相对路径
    function resolveRelativePath(path) {
        const parts = path.split("/");
        const result = [];
        for (const part of parts) {
            if (part === ".") continue;
            if (part === "..") {
                result.pop();
            } else {
                result.push(part);
            }
        }
        return result.join("/");
    }

    // 获取路径的目录
    function getDirOfPath(path) {
        const idx = path.lastIndexOf("/");
        return idx === -1 ? "" : path.substring(0, idx + 1);
    }

    return {
        parseTXT,
        parseEPUB
    };
})();

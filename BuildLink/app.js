const express = require('express');
const cookieParser = require('cookie-parser');
const mysql = require('mysql2');
const path = require('path');

// 載入認證路由，現在它包含所有註冊和登入邏輯 (POST /login)
const authRouter = require('./routes/auth'); 

const app = express();

// --- 網站名稱設定 ---
const SITE_NAME = "BuildLink";

// --- 資料庫連線設定 ---
const dbConfig = {
    host: 'buildlink_db',
    user: 'buildlinkApp',
    password: 'buildlinkPassword', 
    database: 'BuildLinkApp' 
};
const connection = mysql.createConnection(dbConfig);
connection.connect(err => {
    if (err) {
        // 關鍵修正：連線失敗時，只記錄錯誤，讓 Express 繼續啟動
        console.error('資料庫連線失敗: ' + err.stack); 
    } else {
        console.log('成功連線到 MySQL 資料庫，連線 ID: ' + connection.threadId);
    }
});

// 將 connection 物件儲存到 app.locals，讓路由可以使用
app.locals.connection = connection;

// --- 中介軟體 (Middleware) 設定 ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs'); // 確認使用 HJS 模板引擎
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// 應用認證路由 (處理 /register, /login 的 POST)
app.use('/', authRouter); 

// --- 核心函式: 檢查登入狀態 (Middleware) ---
// 檢查是否有任一身份的 Cookie 存在
function checkLogin(req, res, next) {
    if (req.cookies.user_id || req.cookies.partner_id) {
        // 如果有任何一種身份登入，則通過檢查
        next();
    } else {
        // 尚未登入，導向登入頁面
        res.redirect('/login');
    }
}

// --- 路由定義 ---

// GET /login: 顯示單一登入頁面 (包含 Cookie 檢查與訊息處理)
app.get('/login', (req, res) => {
    // 1. Cookie 檢查：如果有 Cookie，自動導向對應首頁
    if (req.cookies.user_id) return res.redirect('/');
    if (req.cookies.partner_id) return res.redirect('/partner/home');
    
    // 2. 訊息處理：從 Query String 取得註冊成功或登入失敗訊息
    const success = req.query.status ? decodeURIComponent(req.query.status) : null;
    const error = req.query.error ? decodeURIComponent(req.query.error) : null;

    // 顯示登入模板 (包含身份選單)
    res.render('login', { 
        title: `${SITE_NAME} 系統登入`,
        success: success, // 傳遞成功訊息給 HJS 模板
        error: error      // 傳遞錯誤訊息給 HJS 模板
    });
});

// GET /logout: 登出功能 (不變)
app.get('/logout', (req, res) => {
    // 清除所有可能的 Cookie
    res.clearCookie('user_id');
    res.clearCookie('partner_id');
    res.redirect('/login');
});

// --- 員工專屬路由 ---

// GET /: 員工首頁 (需要員工登入)
app.get('/', checkLogin, (req, res) => {
    // 1. 如果是夥伴 Cookie，將其導向夥伴首頁 (防止跨身份存取)
    if (req.cookies.partner_id) return res.redirect('/partner/home'); 
    
    const empId = req.cookies.user_id;
    
    // 2. 嚴格檢查：確認 user_id 存在。如果沒有，代表登入狀態異常，強制登出
    if (!empId) {
        console.warn('員工登入狀態不完整，強制登出。');
        res.clearCookie('partner_id'); // 雙重保險
        return res.redirect('/login');
    }

    const sql = 'SELECT emp_name FROM employees WHERE emp_id = ?';
    
    // 這裡我們假設 connection 已經在 app.locals 中設置
    connection.query(sql, [empId], (err, results) => {
        if (err || results.length === 0) {
            console.error('查詢員工姓名失敗:', err);
            res.clearCookie('user_id');
            return res.redirect('/login');
        }
        
        res.render('index', { 
            title: `${SITE_NAME} - 員工首頁`, 
            username: empId, 
            name: results[0].emp_name
        });
    });
});

// --- 夥伴專屬路由 ---

// GET /partner/home: 夥伴專屬首頁 (不變)
app.get('/partner/home', checkLogin, (req, res) => {
    // 1. 如果是員工 Cookie，將其導向員工首頁 (防止跨身份存取)
    if (req.cookies.user_id) return res.redirect('/'); 

    const partnerId = req.cookies.partner_id;

    // 2. 嚴格檢查：確認 partner_id 存在。如果沒有，代表登入狀態異常，強制登出
    if (!partnerId) {
        console.warn('夥伴登入狀態不完整，強制登出。');
        res.clearCookie('user_id'); // 雙重保險
        return res.redirect('/login');
    }
    
    // 這裡我們不再查詢資料庫，直接使用 Cookie 中的 ID 
    
    res.render('partnerHome', { 
        title: 'BuildLink - 合作夥伴專區', 
        partnerId: partnerId,
        modules: [
            { link: '/quotations/new', name: '創建新報價' },
            { link: '/orders/status', name: '查看訂單狀態' },
            { link: '/invoices/view', name: '查看發票與請款' }
        ]
    });
});


// --- 啟動伺服器 (解決 EADDRINUSE 錯誤) ---
const PORT = 80;
// 關鍵修正：將 app.listen 的結果儲存在 server 變數中
const server = app.listen(PORT, () => {
    console.log(`BuildLink 網站運行中，監聽埠號 ${PORT}`);
    console.log(`請在瀏覽器中開啟: http://localhost:8081/`);
});

// 新增的 SIGTERM 處理器：確保伺服器在 Nodemon 重啟或 Docker 關閉時能優雅退出
process.on('SIGTERM', () => {
    console.log('接收到 SIGTERM 訊號，正在關閉伺服器...');
    server.close(() => {
        console.log('HTTP 伺服器已優雅關閉。');
        process.exit(0); // 確保程序退出，釋放資源
    });
});

module.exports = app;
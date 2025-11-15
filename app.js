const express = require('express');
const cookieParser = require('cookie-parser');
const mysql = require('mysql2');
const path = require('path');

const authRouter = require('./routes/auth'); 
const partnerRouter = require('./routes/partner'); // 確保夥伴路由也被載入

const app = express();
const SITE_NAME = "BuildLink";

// --- 資料庫連線設定 ---
const dbConfig = {
    host: 'buildlink_db',
    user: 'buildlinkApp',
    password: 'buildlinkPassword', 
    database: 'BuildLinkApp' 
};

let connection;
const MAX_RETRIES = 5;
let retryCount = 0;

function connectToDatabase() {
    connection = mysql.createConnection(dbConfig);
    connection.connect(err => {
        if (err) {
            console.error(`[DB ERROR] 資料庫連線失敗 (嘗試 ${retryCount + 1}/${MAX_RETRIES}): ${err.code}`);
            
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                // 延遲 5 秒後重試連線
                setTimeout(connectToDatabase, 5000); 
            } else {
                console.error('[DB FATAL] 超過最大重試次數，網站將在無資料庫連線下運行。');
                // 網站繼續運行，但依賴資料庫的功能將失敗
                app.locals.connection = null; 
            }
        } else {
            console.log('✅ 成功連線到 MySQL 資料庫，連線 ID: ' + connection.threadId);
            app.locals.connection = connection;
            retryCount = 0; // 重置計數器
        }
    });
}

// 啟動連線嘗試
connectToDatabase(); 


// --- 中介軟體 (Middleware) 設定 ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs'); 
app.set('view cache', false); // 關閉模板快取

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// 應用認證路由
app.use('/', authRouter); 
app.use('/', partnerRouter); // 確保夥伴路由也在 app.js 中被使用

// --- 核心函式: 檢查登入狀態 (Middleware) ---
function checkLogin(req, res, next) {
    if (req.cookies.user_id || req.cookies.partner_id) {
        next();
    } else {
        res.redirect('/login');
    }
}

// --- 路由定義 ---

app.get('/login', (req, res) => {
    if (req.cookies.user_id) return res.redirect('/');
    if (req.cookies.partner_id) return res.redirect('/partner/home');
    
    const success = req.query.status ? decodeURIComponent(req.query.status) : null;
    const error = req.query.error ? decodeURIComponent(req.query.error) : null;

    res.render('login', { 
        title: `${SITE_NAME} 系統登入`,
        success: success, 
        error: error 
    });
});

app.get('/logout', (req, res) => {
    res.clearCookie('user_id');
    res.clearCookie('partner_id');
    res.redirect('/login');
});

// --- 員工專屬路由 ---

app.get('/', checkLogin, (req, res) => {
    if (req.cookies.partner_id) return res.redirect('/partner/home'); 
    
    const empId = req.cookies.user_id;
    if (!empId) return res.redirect('/login'); 

    if (!app.locals.connection) {
        const errorMsg = encodeURIComponent('系統錯誤：資料庫連線遺失。');
        return res.redirect(`/login?error=${errorMsg}`);
    }

    const sql = 'SELECT emp_name FROM employees WHERE emp_id = ?';
    
    app.locals.connection.query(sql, [empId], (err, results) => {
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

// --- 夥伴專屬路由 (從 partner.js 搬運過來，確保在 app.js 中被使用) ---
app.get('/partner/home', checkLogin, (req, res) => {
    if (req.cookies.user_id) return res.redirect('/'); 

    const partnerId = req.cookies.partner_id;
    if (!partnerId) return res.redirect('/login');
    
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


// --- 啟動伺服器 ---
const PORT = 80;
const server = app.listen(PORT, () => {
    console.log(`BuildLink 網站運行中，監聽埠號 ${PORT}`);
    console.log(`請在瀏覽器中開啟: http://localhost:8081/`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        process.exit(0); 
    });
});

module.exports = app;
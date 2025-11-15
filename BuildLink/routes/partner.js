const express = require('express');
const router = express.Router();

// --- 夥伴登入狀態檢查中介軟體 ---
function checkPartnerLogin(req, res, next) {
    if (req.cookies.partner_id) {
        // 夥伴已登入，允許進入下一層
        next();
    } else {
        // 尚未登入，導向員工登入頁面 (未來可改為夥伴專屬登入頁)
        res.redirect('/login'); 
    }
}

// GET /partner/home: 夥伴專屬首頁 (需要登入)
router.get('/partner/home', checkPartnerLogin, (req, res) => {
    // 這裡可以直接從 Cookie 讀取 username，不需要查詢資料庫
    const partnerId = req.cookies.partner_id;

    // 渲染夥伴首頁模板
    res.render('partnerHome', { 
        title: 'BuildLink - 合作夥伴專區', 
        partnerId: partnerId,
        // 我們將在頁面上顯示給夥伴的功能連結
        modules: [
            { link: '/quotations/new', name: '創建新報價' },
            { link: '/orders/status', name: '查看訂單狀態' },
            { link: '/invoices/view', name: '查看發票與請款' }
        ]
    });
});

module.exports = router;
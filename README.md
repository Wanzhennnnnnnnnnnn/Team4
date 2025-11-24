# Team4
```mermaid
flowchart TD
    Root[BuildLink<br>承包商 B2B 採購平台]

    %% --- Shing.Rong.LEE (系統入口與身份驗證) ---
    Root --> Sys("系統核心與入口<br><b>Shing.Rong.LEE</b>")
    Sys --> Auth("身份驗證 (Auth)")
    Auth --> Login("登入系統 (Contractor Login)")
    Auth --> Reg("註冊系統 (Registration)")
    Auth --> Forgot("忘記密碼 (Forgot Password)")
    
    Sys --> UserMgmt("使用者管理 (User Mgmt)")
    UserMgmt --> Profile("個人資訊修改 (Edit Profile)<br><span style='color:#2980b9'>[未來功能]</span>")
    
    %% --- Wan.Zhen.HSU (核心業務流程 - 已完成) ---
    Root --> Flow("核心業務流程<br><b>Wan.Zhen.HSU</b>")
    Flow --> Dash("儀表板 (Dashboard)")
    Dash --> DashStats("採購數據概覽")
    
    Flow --> Proj("專案管理 (Project Mgmt)")
    Proj --> ProjList("專案列表")
    Proj --> ProjAdd("新增專案")
    
    Flow --> Order("訂單與採購 (Procurement)")
    Order --> Cart("購物車與下單")
    Order --> Hist("歷史訂單查詢")
    
    Flow --> SupMkt("供應商市集 (Marketplace)")
    SupMkt --> SupList("供應商搜尋與列表")
    SupMkt --> SupDetail("供應商詳情與目錄")

    %% --- Zhafran (加值與擴充功能 - 未來開發) ---
    Root --> Ext("加值與擴充功能<br><b>Zhafran</b>")
    Ext --> Rating("評價系統 (Rating System)")
    Rating --> RateOrder("訂單完成後評分")
    Rating --> RateView("查看供應商評價")
    
    Ext --> Fin("財務管理 (Finance)")
    Fin --> Invoice("發票系統 (Invoice Mgmt)")
    Fin --> Payment("付款狀態追蹤")
    
    Ext --> Adv("進階功能 (Advanced)")
    Adv --> Notify("通知中心 (Notifications)")
    Adv --> Report("進階報表 (Advanced Reports)")

    %% --- 跨模組連接 ---
    Login --> Dash
    Dash --> Proj
    Proj -.->|關聯採購| Order
    SupList --> SupDetail
    SupDetail --> Cart
    Cart --> Order
    Order -.->|完成後| RateOrder
    Order -.->|開立| Invoice

    %% --- 顏色定義 ---
    %% 核心已完成 (綠色)
    classDef core fill:#81C59E,stroke:#27ae60,stroke-width:2px;
    %% 未來開發 (藍色)
    classDef future fill:#AED6F1,stroke:#2980b9,stroke-width:2px,stroke-dasharray: 5 5;
    %% 基礎架構 (灰色)
    classDef infra fill:#F0F3F4,stroke:#95A5A6,stroke-width:2px;

    %% --- 應用顏色 ---
    class Auth,Login,Reg,Forgot,Dash,DashStats,Proj,ProjList,ProjAdd,Order,Cart,Hist,SupMkt,SupList,SupDetail core
    class Profile,Rating,RateOrder,RateView,Fin,Invoice,Payment,Adv,Notify,Report future
    class Root,Sys,Flow,Ext,UserMgmt infra
   ```

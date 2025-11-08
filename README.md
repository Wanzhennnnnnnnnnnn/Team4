# Team4
```mermaid
flowchart TD
    A[BuildLink 網站功能架構]

    %% --- HSU 的工作 ---
    A --> C("共同驗證 (Auth)<br><b>Shing.Rong.LEE</b>")
    C --> C1("Register/Login (Contractor)")
    C --> C2("Register/Login (Supplier)")
    
    A --> F("數據儀表板<br><b>Shing.Rong.LEE</b>")
    F --> F1(Monitor Multi-Project Dashboard)
    F --> F2(View Analytics Reports)

    %% --- LEE 的工作 ---
    A --> B("Contractor (承包商) 功能<br><b>Wan.Zhen.HSU</b>")
    B --> D("採購管理")
    D --> D1(Manage Supplier)
    D --> D2(Create Purchase Order)
    
    B --> E("交付追蹤")
    E --> E1(Track Delivery)

    B --> F_Sub("帳務管理")
    F_Sub --> F_Sub1(Manage Invoices)


    %% --- Zafran 的工作 ---
    A --> G("Supplier (供應商) 功能<br><b>Zhafran</b>")
    G --> I("供應鏈管理")
    I --> I1(Update Material)
    I --> I2(Confirm Purchase Order)
    
    G --> J("交付管理")
    J --> J1(Provide Delivery)
    
    G --> K("帳務管理")
    K --> K1(Send Invoices)


    %% --- 顏色定義 (實作優先權) ---
    
    %% MVP (高優先) - 綠色
    classDef highPriority fill:#d9f9d9,stroke:#333,stroke-width:2px;
    %% Full-Featured (低優先) - 藍色
    classDef lowPriority fill:#d9d9f9,stroke:#333,stroke-width:2px;

    %% --- 應用顏色 ---
    class C,C1,C2,D,D1,D2,E,E1,I,I1,I2,J,J1 highPriority
    class F,F1,F2,F_Sub,F_Sub1,K,K1 lowPriority
   ```


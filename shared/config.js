
const CONFIG = {
    // Google Sheets API Key
    API_KEY: 'AIzaSyC2KfWPC0lqWaD1Fyo0xvGd6qMU8Uk94O0',
    
    // Google Sheets ID
    SHEET_ID: '1R1si_-pzlM9doWfrePV6emECMaIIUifQSOtmh155vG8',
    
    // Google Apps Script URL
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbx95ctdi-yZJpXp8pU-7Vxfbq-xLvpUXPJ27I05CbUrMSpMiTSdNeFwCHZIDKbVVX3K6g/exec",
    
    // Sheet Names Configuration (customize these to match your Google Sheet)
    SHEETS: {
        STUDENTS: 'Students',
        BUSES: 'Buses',
        DRIVERS: 'Drivers',
        LIVE_LOCATIONS: 'LiveLocations'
    }
};

// Make config available globally
window.CONFIG = CONFIG;

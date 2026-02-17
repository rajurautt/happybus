// shared/api.js - Google Sheets API Helper
// Using centralized configuration from config.js
// Make sure to include config.js before this file in your HTML

const API_KEY = window.CONFIG ? window.CONFIG.API_KEY : 'AIzaSyAEgboC033MAgBVuxc9Qu9aRE0RLj-mkVY';
const SHEET_ID = window.CONFIG ? window.CONFIG.SHEET_ID : '1Tm7lhBZzK5xaz_Sr3lVxkmQTzuiagllhlRpDYjpD4XU';

class SheetsAPI {
    static async getSheet(sheetName) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}?key=${API_KEY}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            return data.values || [];
        } catch (error) {
            console.error('Error fetching sheet:', error);
            return [];
        }
    }

    static async updateCell(sheetName, range, value) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}!${range}?valueInputOption=RAW&key=${API_KEY}`;
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    values: [[value]]
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Error updating cell:', error);
            return null;
        }
    }

    static async appendRow(sheetName, values) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}:append?valueInputOption=RAW&key=${API_KEY}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    values: [values]
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Error appending row:', error);
            return null;
        }
    }

    // Get student data by roll number
    static async getStudent(roll) {
        const students = await this.getSheet('Students');
        if (students.length > 1) {
            for (let i = 1; i < students.length; i++) {
                if (students[i][2] === roll) { // Roll is in column C (index 2)
                    return {
                        name: students[i][0],
                        studentId: students[i][1],
                        roll: students[i][2],
                        department: students[i][3],
                        phone: students[i][4],
                        status: students[i][6]
                    };
                }
            }
        }
        return null;
    }

    // Get bus data
    static async getBuses() {
        const buses = await this.getSheet('Buses');
        const result = [];
        if (buses.length > 1) {
            for (let i = 1; i < buses.length; i++) {
                result.push({
                    busId: buses[i][0],
                    route: buses[i][1],
                    driver: buses[i][2],
                    phone: buses[i][3],
                    capacity: buses[i][4],
                    status: buses[i][5],
                    startTime: buses[i][6],
                    endTime: buses[i][7],
                    routeKey: buses[i][8]
                });
            }
        }
        return result;
    }

    // Get live locations
    static async getLiveLocations() {
        const locations = await this.getSheet('LiveLocations');
        const result = [];
        if (locations.length > 1) {
            for (let i = 1; i < locations.length; i++) {
                result.push({
                    busId: locations[i][0],
                    latitude: parseFloat(locations[i][1]),
                    longitude: parseFloat(locations[i][2]),
                    speed: locations[i][3],
                    lastUpdate: locations[i][4],
                    nextStop: locations[i][5]
                });
            }
        }
        return result;
    }

    // Update bus location (for driver app)
    static async updateBusLocation(busId, lat, lng, speed) {
        const timestamp = new Date().toISOString();
        const locations = await this.getSheet('LiveLocations');
        
        let rowIndex = -1;
        if (locations.length > 1) {
            for (let i = 1; i < locations.length; i++) {
                if (locations[i][0] === busId) {
                    rowIndex = i + 1; // +1 because sheets are 1-indexed
                    break;
                }
            }
        }

        if (rowIndex > 0) {
            // Update existing row
            await this.updateCell('LiveLocations', `B${rowIndex}`, lat);
            await this.updateCell('LiveLocations', `C${rowIndex}`, lng);
            await this.updateCell('LiveLocations', `D${rowIndex}`, speed);
            await this.updateCell('LiveLocations', `E${rowIndex}`, timestamp);
        } else {
            // Add new row
            await this.appendRow('LiveLocations', [busId, lat, lng, speed, timestamp, '']);
        }
    }

    // Get driver by bus ID
    static async getDriver(busId) {
        const drivers = await this.getSheet('Drivers');
        if (drivers.length > 1) {
            for (let i = 1; i < drivers.length; i++) {
                if (drivers[i][0] === busId) {
                    return {
                        busId: drivers[i][0],
                        name: drivers[i][1],
                        phone: drivers[i][2],
                        pin: drivers[i][3]
                    };
                }
            }
        }
        return null;
    }
}

// Utility functions
const utils = {
    formatTime(timeString) {
        return new Date(`1970-01-01T${timeString}:00`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    },
    
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
};

export { SheetsAPI, utils };
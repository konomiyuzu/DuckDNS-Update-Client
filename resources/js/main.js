function setTray() {
    // Tray menu is only available in window mode
    if (NL_MODE != "window") {
        console.log("INFO: Tray menu is only available in the window mode.");
        return;
    }

    // Define tray menu items
    let tray = {
        icon: "/resources/icons/ducky_icon.png",
        menuItems: [
            { id: "CONFIGURE", text: "Configure" },
            { id: "UPDATE", text: "Force Update" },
            { id: "SEP", text: "-" },
            { id: "QUIT", text: "Quit" }
        ]
    };

    // Set the tray menu
    Neutralino.os.setTray(tray);
}

function onTrayMenuItemClicked(event) {
    switch (event.detail.id) {
        case "CONFIGURE":
            // Display version information
            Neutralino.window.show();
            break;
        case "UPDATE":
            forceUpdate();
            Neutralino.os.showMessageBox("force update", "force update completed")
            break;
        case "QUIT":
            // Exit the application
            Neutralino.app.exit();
            break;
    }
}

function onWindowClose() {
    Neutralino.window.hide();
}

Neutralino.init();
Neutralino.events.on("trayMenuItemClicked", onTrayMenuItemClicked);
Neutralino.events.on("windowClose", onWindowClose);

// Conditional initialization: Set up system tray if not running on macOS
if (NL_OS != "Darwin") { // TODO: Fix https://github.com/neutralinojs/neutralinojs/issues/615
    setTray();
}

class ConfigManager {
    static configPath = "./config.json";
    static #config;

    static get loaded(){
        return this.#config != null;
    }
    static get config() {
        if (!this.loaded) throw new Error("Config has not been loaded yet, call loadConfig() before trying to access config files");
        return this.#config;
    }

    static async loadConfig() {
        if(this.loaded) throw new Error("Config already loaded");

        try {
            await Neutralino.filesystem.getStats(this.configPath);

            //file exists
            const jsonString = await Neutralino.filesystem.readFile(this.configPath);
            this.#config = JSON.parse(jsonString);
            return this.#config;
        }
        //file doesnt exist or some other error
        catch (e) {
            if (e.code != "NE_FS_NOPATHE") {
                console.error(e);
                return;
            }

            this.#config = {
                token:"",
                interval:5,
                domains:[]
            }

            this.saveConfig();
            return this.#config;

        }
    }

    static async saveConfig() {
        if(!this.loaded) throw new Error("Tried to config before loading");

        Neutralino.filesystem.writeFile(this.configPath, JSON.stringify(this.#config));
    }

}

const lastUpdateDisplay = document.getElementById("lastUpdateDisplay");
const tokenInput = document.getElementById("token");
const intervalInput = document.getElementById("interval");
const domainInput = document.getElementById("addDomainInput");
const domainButton = document.getElementById("addDomainButton");
const domainTable = document.getElementById("domainTable");

domainButton.addEventListener("click", addDomain);
domainInput.addEventListener("keypress", (e) => {
    if (e.key == "Enter") {
        e.preventDefault();
        addDomain();
      }
})

tokenInput.addEventListener("change", () => {
    const config = ConfigManager.config;
    config.token = tokenInput.value;
    ConfigManager.saveConfig();
})

intervalInput.addEventListener("change", () => {
    const config = ConfigManager.config;
    const interval = parseInt(intervalInput.value);
    
    if(interval <= 0){
        alert("interval must be >= 1");
        return;
    }

    if(interval > 60){
        alert("interval must be < 60");
        return;
    }

    config.interval = interval;
    ConfigManager.saveConfig();

    forceUpdate();
})

async function main() {
    const config = await ConfigManager.loadConfig();

    tokenInput.value = config.token;
    intervalInput.value = config.interval;
    updateTable();

    forceUpdate();
}

let intervalId;
//sets up a new interval
function forceUpdate(){
    const config = ConfigManager.config;

    update();
    if(intervalId != null) clearInterval(intervalId);
    intervalId = setInterval(update,60 * 1000 * config.interval);
}

function update(){
    const config = ConfigManager.config;

    //update date
    const date = new Date();
    lastUpdateDisplay.innerHTML = `last update: ${date.getHours().toString().padStart(2,"0")}:${date.getMinutes().toString().padStart(2,"0")}:${date.getSeconds().toString().padStart(2,"0")}`;
    
    const nextDate = new Date(date.getTime() + 60 * 1000 * config.interval)
    lastUpdateDisplay.innerHTML += `<br>next update: ${nextDate.getHours().toString().padStart(2,"0")}:${nextDate.getMinutes().toString().padStart(2,"0")}:${nextDate.getSeconds().toString().padStart(2,"0")}`;
    
    updateDNS();
};

function updateTable() {
    const domains = ConfigManager.config.domains;

    //clear table
    domainTable.innerHTML = ""
    
    //make info row
    const infoRow = document.createElement("tr")
    infoRow.append(document.createElement("td"),document.createElement("td"),document.createElement("td"));
    infoRow.children[0].innerHTML = "name";
    infoRow.children[1].innerHTML = "enabled";
    infoRow.children[2].innerHTML = "delete";

    domainTable.append(infoRow);

    for(const domain of domains){
        const row = document.createElement("tr")
        
        const nameElement = document.createElement("td");
        const nameHeader = document.createElement("h2");
        nameHeader.innerHTML = domain.name + ".duckdns.org";
        nameElement.append(nameHeader);

        const enabledElement = document.createElement("td");
        const enabledBox = document.createElement("input");
        enabledBox.type = "checkbox";
        enabledBox.classList = "checkbox";
        enabledBox.checked = domain.enabled;
        enabledBox.addEventListener("click", toggleEnabled)
        enabledElement.append(enabledBox);

        const deleteElement = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.innerHTML = "delete";
        deleteButton.addEventListener("click", removeDomain)
        deleteElement.append(deleteButton);

        row.append(nameElement,enabledElement,deleteElement);
        domainTable.append(row);
    }
}

function updateDNS(){
    const config = ConfigManager.config;
    const token = config.token;
    const domains = config.domains;

    //since fetch is blocked by CORS, use curl instead
    Neutralino.os.execCommand(`curl "https://www.duckdns.org/update?domains=${domains.filter(x=>x.enabled).map(x=>x.name).join(",")}&token=${token}"`);
    
    //set disabled domains' ips to 0.0.0.0;
    Neutralino.os.execCommand(`curl "https://www.duckdns.org/update?domains=${domains.filter(x=>!x.enabled).map(x=>x.name).join(",")}&token=${token}&ip=0.0.0.0"`);
}

function addDomain(){
    const name = domainInput.value.trim();
    const config = ConfigManager.config;

    domainInput.value = "";
    if(name == "") {
        alert("input a domain name");
        return;
    }

    if(config.domains.map(x => x.name).includes(name)){
        alert("duplicate domain name");
        return;
    }

    //valid characters are a-z, A-Z, 0-9 and -
    if(/[^a-z0-9\-]/i.test(name)) {
        alert("domain name cannot contain invalid characters");
        return;
    }

    config.domains.push(
        {name:name, enabled:true}
    );

    ConfigManager.saveConfig();
    updateTable();
}

function toggleEnabled(){
    const config = ConfigManager.config;
    
    const row = this.parentNode.parentNode
    const name = row.firstChild.firstChild.innerHTML.split(".")[0];
    const index = config.domains.map(x=>x.name).indexOf(name);

    config.domains[index].enabled = this.checked;
    ConfigManager.saveConfig();
}

function removeDomain(){
    const config = ConfigManager.config;
    
    const row = this.parentNode.parentNode
    const name = row.firstChild.firstChild.innerHTML.split(".")[0];
    const index = config.domains.map(x=>x.name).indexOf(name);

    config.domains.splice(index,1);
    ConfigManager.saveConfig();

    domainTable.removeChild(row);
}

main();
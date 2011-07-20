var EXPORTED_SYMBOLS = ['results',
'popupNotify',
'openWebsiteInTab',
'sharedWriteRule',
'getHostWithoutSub',
'restartNow',
'alertRuleFinished'];

var results = {
    goodSSL : [],
    permWhitelistLength : 0,
    whitelist : [],
    tempNoAlerts : []
};

var redirectedTab =  [[]]; //Tab info for pre-redirect URLs.


//Generic notifier method
function popupNotify(title,body){
    try{
        var alertsService = Components.classes["@mozilla.org/alerts-service;1"]
            .getService(Components.interfaces.nsIAlertsService);
        alertsService.showAlertNotification("chrome://httpsfinder/skin/httpRedirect.png",
            title, body, false, "", null);
    }
    catch(e){ /*Do nothing*/ }
};

function openWebsiteInTab(addr){
    if(typeof gBrowser == "undefined"){
        var window = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
        var browserWindow = window.getMostRecentWindow("navigator:browser").getBrowser();
        var newTab = browserWindow.addTab(addr, null, null);
        browserWindow.selectedTab = newTab;

    }
    else
        gBrowser.selectedTab = gBrowser.addTab(addr);
};

//Remove notification called from setTimeout(). Looks through each tab for an alert with mataching key. Removes it, if exists.
function removeNotification(key){
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);

    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    //key is a formatted as alert type (e.g. "httpsfinder-restart"), with the tab index concatinated to the end, httpsfinder-restart2).
    var browsers = currentWindow.gBrowser.browsers;
    for (var i = 0; i < browsers.length; i++)
        if (item = currentWindow.window.getBrowser().getNotificationBox(browsers[i]).getNotificationWithValue(key))
            if(i == currentWindow.gBrowser.getBrowserIndexForDocument(currentWindow.gBrowser.contentDocument))
                currentWindow.window.getBrowser().getNotificationBox(browsers[i]).removeNotification(item);
};

/*
 * Code below this point is for rule writing
 */

//Passed in uri variable is an asciispec uri from pre-redirect. (i.e. full http://www.domain.com)
function sharedWriteRule(hostname, topLevel){       
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);

    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefService);

    var prefs = prefService.getBranch("extensions.httpsfinder.");

    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    var strings = currentWindow.document.getElementById("httpsfinderStrings");

    var title = "";

    var tldLength = topLevel.length - 1;

    if(hostname.indexOf("www.") != -1)
        title = hostname.slice(hostname.indexOf(".",0) + 1,hostname.lastIndexOf(".",0) - tldLength);
    else
        title = hostname.slice(0, hostname.lastIndexOf(".", 0) - tldLength);
    title = title.charAt(0).toUpperCase() + title.slice(1);

    var rule;
    if(hostname == "localhost"){
        title = "Localhost";
        rule = "<ruleset name=\""+ title + "\">" + "\n" +
        "<target host=\"" + hostname + "\" />" +
        "<rule from=\"^http://(www\\.)?" + title.toLowerCase() +
        "\\" +"/\"" +" to=\"https://" + title.toLowerCase() +
        "/\"/>" + "\n" + "</ruleset>";
    }

    else{
        rule = "<ruleset name=\""+ title + "\">" + "\n"
        + "\t" + "<target host=\"" + hostname + "\" />" + "\n";

        //Check hostname for "www.".
        //One will be "domain.com" and the other will be "www.domain.com"
        var targetHost2 = "";
        if(hostname.indexOf("www.") != -1){
            targetHost2 = this.getHostWithoutSub(hostname);
            rule = rule + "\t" + "<target host=\"" + targetHost2 +"\" />" + "\n" +
            "\t" + "<rule from=\"^http://(www\\.)?" + title.toLowerCase() +
            "\\" + topLevel +"/\"" +" to=\"https://www." + title.toLowerCase() +
            topLevel + "/\"/>" + "\n" + "</ruleset>";
        }
        else{
            var domains = hostname.split(".");
            if(domains.length == 2){
                targetHost2 = "www." + hostname;
                rule = rule + "\t" + "<target host=\"" + targetHost2 +"\" />" +
                "\n" + "\t" + "<rule from=\"^http://(www\\.)?" + title.toLowerCase() +
                "\\" + topLevel +"/\"" +" to=\"https://" + title.toLowerCase() +
                topLevel + "/\"/>" + "\n" + "</ruleset>";
            }
            //If hostname includes non-www subdomain, we don't include www in our rule.
            else
                rule = rule + "\t" + "<rule from=\"^http://(www\\.)?" +
                title.toLowerCase() + "\\" + topLevel +"/\"" +" to=\"https://"
                + title.toLowerCase() + topLevel + "/\"/>" + "\n" + "</ruleset>";
        }
    }

    rule = rule + "\n" + "<!-- Rule generated by HTTPS Finder " +
    strings.getString("httpsfinder.version") +
    " -->"

    if(prefs.getBoolPref("showrulepreview")){
        var params = {
            inn:{
                rule:rule
            },
            out:null
        };

        //Workaround for how OS X handles modal dialog windows.. If launched from Preferences, it won't show
        //the dialog until prefwindow closes. So we just make the rule preview non-modal here.
        
        // Returns "WINNT" on Windows,"Linux" on GNU/Linux. and "Darwin" on Mac OS X.
        var osString = Components.classes["@mozilla.org/xre/app-info;1"]
        .getService(Components.interfaces.nsIXULRuntime).OS;

        if(osString == "Darwin")
            currentWindow.openDialog("chrome://httpsfinder/content/rulePreview.xul", "",
                "chrome, dialog, centerscreen, resizable=yes", params).focus();
        else
            currentWindow.openDialog("chrome://httpsfinder/content/rulePreview.xul", "",
                "chrome, dialog, modal,centerscreen, resizable=yes", params).focus();

        if (!params.out)
            return; //user canceled rule
        else
            rule = params.out.rule; //reassign rule value from the textbox
    }

    //Synchronous for FF3.5 compatibility
    var foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].
    createInstance(Components.interfaces.nsIFileOutputStream);

    var file = Components.classes["@mozilla.org/file/directory_service;1"].
    getService(Components.interfaces.nsIProperties).
    get("ProfD", Components.interfaces.nsIFile);
    file.append("HTTPSEverywhereUserRules")
    file.append(title + ".xml");
    try{
        file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);
    }
    catch(e){
        if(e.name == 'NS_ERROR_FILE_ALREADY_EXISTS')
            file.remove(false);
    }
    foStream.init(file, 0x02 | 0x08 | 0x20, 0666, 0);
    var converter = Components.classes["@mozilla.org/intl/converter-output-stream;1"].
    createInstance(Components.interfaces.nsIConverterOutputStream);
    converter.init(foStream, "UTF-8", 0, 0);
    converter.writeString(rule);
    converter.close();

    if(this.results.tempNoAlerts.indexOf(hostname) == -1)
        this.results.tempNoAlerts.push(hostname);

    alertRuleFinished(currentWindow.gBrowser.contentDocument);
};

//return host without subdomain (e.g. input: code.google.com, outpout: google.com)
function getHostWithoutSub(fullHost){
    if(typeof fullHost != 'string')
        return "";
    else
        return fullHost.slice(fullHost.indexOf(".") + 1, fullHost.length);
};

function restartNow(){
    var Application = Components.classes["@mozilla.org/fuel/application;1"].getService(Components.interfaces.fuelIApplication);
    Application.restart();
};

function alertRuleFinished(aDocument){ 
    //Check firefox version and use appropriate method
    var Application = Components.classes["@mozilla.org/fuel/application;1"]
        .getService(Components.interfaces.fuelIApplication);
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator);
    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService);

    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    var strings = currentWindow.document.getElementById("httpsfinderStrings");
    var prefs = prefService.getBranch("extensions.httpsfinder.");

    var removeNotification = this.removeNotification;

    //Determin FF version and use proper method to check for HTTPS Everywhere
    if(Application.version.charAt(0) >= 4){
        Components.utils.import("resource://gre/modules/AddonManager.jsm");
        AddonManager.getAddonByID("https-everywhere@eff.org", function(addon) {
            //Addon is null if not installed
            if(addon == null)
                getHTTPSEverywhere();
            else if(addon != null)
                promptForRestart();
        });
    }
    else{  //Firefox versions below 4.0
        if(!Application.extensions.has("https-everywhere@eff.org"))
            getHTTPSEverywhere();
        else
            promptForRestart();
    }

    //Alert user to install HTTPS Everywhere for rule enforcement
    var getHTTPSEverywhere = function() {     
        var installButtons = [{
            label: strings.getString("httpsfinder.main.getHttpsEverywhere"),
            accessKey: strings.getString("httpsfinder.main.getHttpsEverywhereKey"),
            popup: null,
            callback: getHE  //Why is this needed? Setting the callback directly automatically calls when there is a parameter
        }];
       
        var nb = currentWindow.gBrowser.getNotificationBox(currentWindow.gBrowser.getBrowserForDocument(aDocument));
        nb.appendNotification(strings.getString("httpsfinder.main.NoHttpsEverywhere"),
            'httpsfinder-getHE','chrome://httpsfinder/skin/httpsAvailable.png',
            nb.PRIORITY_INFO_LOW, installButtons);
    };

    //See previous comment (in installButtons)
    var getHE = function(){
        this.openWebsiteInTab("http://www.eff.org/https-everywhere/");
    };

    //HTTPS Everywhere is installed. Prompt for restart
    var promptForRestart = function() {
        var nb = currentWindow.gBrowser.getNotificationBox(currentWindow.gBrowser.getBrowserForDocument(aDocument));
        var pbs = Components.classes["@mozilla.org/privatebrowsing;1"]
        .getService(Components.interfaces.nsIPrivateBrowsingService);

        var key = "httpsfinder-restart" + currentWindow.gBrowser.getBrowserIndexForDocument(currentWindow.gBrowser.contentDocument);

        var restartButtons = [{
            label: strings.getString("httpsfinder.main.restartYes"),
            accessKey: strings.getString("httpsfinder.main.restartYesKey"),
            popup: null,
            callback: restartNow
        }];

        if (pbs.privateBrowsingEnabled)
            nb.appendNotification(strings.getString("httpsfinder.main.restartPromptPrivate"),
                key,'chrome://httpsfinder/skin/httpsAvailable.png',
                nb.PRIORITY_INFO_LOW, restartButtons);
        else
            nb.appendNotification(strings.getString("httpsfinder.main.restartPrompt"),
                key,'chrome://httpsfinder/skin/httpsAvailable.png',
                nb.PRIORITY_INFO_LOW, restartButtons);

        if(prefs.getBoolPref("dismissAlerts"))
            currentWindow.setTimeout(function(){
                removeNotification(key)
            },prefs.getIntPref("alertDismissTime") * 1000, 'httpsfinder-restart');
    };   
};


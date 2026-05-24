on runUpdater(theURL)
    set updaterScript to POSIX path of (path to home folder) & ".config/spicetify/CustomApps/ivLyrics/updater/unix/ivlyrics-updater.sh"
    try
        do shell script "/usr/bin/nohup /bin/bash " & quoted form of updaterScript & " " & quoted form of theURL & " >/dev/null 2>&1 &"
        display notification "Update started in the background." with title "ivLyrics Updater"
    on error errorMessage
        display dialog "ivLyrics Updater could not start:" & return & errorMessage buttons {"OK"} default button "OK" with icon caution
    end try
end runUpdater

on open location theURL
    runUpdater(theURL)
end open location

on run
    runUpdater("ivlyrics-updater://update")
end run

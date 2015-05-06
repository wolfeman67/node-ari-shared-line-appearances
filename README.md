# node-ari-shared-line-appearances
Co-op implementation of SLA in ARI using Node.js

This implementation assumes that you have at least Asterisk 13.4.0 running.

You must also have a valid ARI user in ari.conf named "user" and have a password "pass"
You must have 127.0.0.1 (or localhost) configured as the bindaddr in http.conf
You must have 8088 configured as the bindport in http.conf

You must have a valid configuration JSON file and a valid sharedExtension object inside of it (which contains a list of valid trunks and a list of valid station endpoints). An example of this would be:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
{
  "sharedExtensions": [
    {
      "42": {
        "trunks": [
          "42-A"
        ]
        "stations": [
          "SIP/phone1",
          "SIP/phone2"
        ]
      }
    }
  ]
}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
At this moment, this application only supports one trunk per sharedExtension.
This trunk can have any name, however, but the SIP trunk must appear in sip.conf, like below:
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
[42-A]
type = peer
host = 0.0.0.0
username = 42-A
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

You must also have a dialplan extension in extensions.conf that leads to the application
This extension must have a Stasis function that has the same name as what application is being started in the code.
This extension must also have an argument to represent the SLA bridge to reach.
An example with a device state hint is below:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exten => 42,hint,Stasis:42
exten => 42,1,NoOp()
    same => n,Stasis(sla,42)
    same => n,Hangup()
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
If an inbound caller were to be kicked out of this shared extension, they would be hungup.
You could also make the dialplan call the application again to redirect a user to another shared extension like below:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exten => 42,hint,Stasis:42
exten => 42,1,NoOp()
    same => n,Stasis(sla,42)
    same => n,Goto(43,1)

exten => 43,hint,Stasis:43
exten => 43,1,NoOp()
    same => n,Stasis(sla,43)
    same => n,Hangup()
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The application is invoked using node app.js [configurationPathAndFileName]
The configurationPathAndFileName is relative to the dal.js, which is located inside of the lib/data directory.

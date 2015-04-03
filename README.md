# node-ari-shared-line-appearances
Co-op implementation of SLA in ARI using Node.js

This implementation assumes that you have at least Asterisk 12.0.0 running. This is the version where ARI first came around, and it should have all of the functions required for this project.

You must also have a valid ARI user in ari.conf named "user" and have a password "pass", as well as have 127.0.0.1 (or localhost) and 8088 configured as the bindaddr and bindport respectively in http.conf

It is also required that you have a valid configuration JSON file and a valid sharedExtension object inside of it (which contains a list of valid trunks and a list of valid station endpoints).  An example of this would be:

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
Right now, however, this application only supports one trunk per sharedExtension, it can have any name, however, but the SIP trunk must appear in sip.conf, like below: 
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
[42-A]
type = peer
host = 0.0.0.0
username = 42-A
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

You must also have a dialplan extension in extensions.conf that leads to the application (must have same name as what application is being started in the code) and that has an argument to represent the SLA bridge to reach.  An example with a device state hint is below:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exten => 42,hint,Stasis:42
exten => 42,1,NoOp()                                                             
    same => n,Stasis(sla,42)                                                    
    same => n,Hangup()
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
If an inbound caller were to be kicked out of this shared extension, they would be hungup. You could also make the dialplan call the application again to redirect a user to another shared extension like below:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exten => 42,hint,Stasis:42
exten => 42,1,NoOp()                                                             
    same => n,Stasis(sla,42)
    same => n,Goto(420,1)                                                 

exten => 420,hint,Stasis:420
exten => 420,1,NoOp()
    same => n,Stasis(sla,420)
    same => n,Hangup()
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The application is invoked using node app.js [configurationFilePathAndFileName]

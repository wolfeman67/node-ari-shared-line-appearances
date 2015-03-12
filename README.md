# node-ari-shared-line-appearances
Co-op implementation of SLA in ARI using Node.js

This implementation assumes that you have at least Asterisk 12.0.0 running. This is the version where ARI first came around, and it should have all of the functions required for this project.

You must also have a valid ARI user in ari.conf named "user" and have a password "pass", as well as have 127.0.0.1 (or localhost) and 8088 configured as the bindaddr and bindport respectively in http.conf

It is also required that you have a valid configuration JSON file and a valid sharedExtension object inside of it (which also has a valid trunk that contains valid endpoints underneath the trunk).  An example of this would be:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
{                                                                                
  "sharedExtensions": [                                                          
  {                                                                              
    "leExtension": {                                                             
      "trunks": [                                                                
        {"42":                                                                   
          {                                                                      
            "stations": [                                                        
            {"endpoint": "SIP/phone1"                                            
            },                                                                   
            {"endpoint": "SIP/phone2"}                                           
            ]                                                                    
          }                                                                      
        }                                                                        
      ]                                                                          
    }                                                                            
  }                                                                              
  ]                                                                              
}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

You must also have a dialplan extension in extensions.conf that leads to the application (must have same name as what application is being started in the code) and that has an argument to represent the SLA bridge to reach.  An example is below:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exten => 99,1,NoOp()                                                             
    same => n,Stasis(sla,999)                                                    
    same => n,Hangup()
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The application is invoked using node app.js [configurationFilePathAndFileName] [sharedExtension]

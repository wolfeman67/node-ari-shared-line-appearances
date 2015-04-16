# node-ari-shared-line-appearances
Co-op implementation of SLA in ARI using Node.js

This implementation assumes that you have at least Asterisk 13.4.0 running. This is the version where hold event intercepting will be implemented, and this feature is required for SLA to function properly.

You must also have a valid ARI user in ari.conf named "user" and have a password "pass", as well as have 127.0.0.1 (or localhost) and 8088 configured as the bindaddr and bindport respectively in http.conf

It is also required that you have a valid configuration JSON file and a valid sharedExtension object inside of it (which contains a list of valid trunks and a list of valid station endpoints). An example of this would be:

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
A sample extensions.conf using this application (which also has a redirect to another instance of this application if the original fails) is found in the sampleConfigurationFiles folder. A sample SIP.conf, which includes the SIP trunk 42-A and the SIP users phone1 and phone2, can be found there, as well.

The application is invoked using node app.js [configurationFilePathAndFileName]

# node-ari-shared-line-appearances
Co-op implementation of SLA in ARI using Node.js

This implementation assumes that you have at least Asterisk 13.4.0 running.

You must also have a valid ARI user in ari.conf named "user" and have a password "pass"
You must have 127.0.0.1 (or localhost) configured as the bindaddr in http.conf
You must have 8088 configured as the bindport in http.conf

You must have a valid configuration JSON file and a valid sharedExtension object inside of it (which contains a list of valid trunks and a list of valid station endpoints).

You must also have a dialplan extension in extensions.conf that leads to the application.
This extension must have a Stasis function that has the same name as what application is being started in the code.
This extension must also have an argument to represent the SLA bridge to reach.

If an inbound caller were to be kicked out of this shared extension, they could either be hung up or redirected to another shared extension.

A sample extensions.conf using this application can be found in the sampleConfigurationFiles folder.
This sample extension also has a dialplan redirect to another sample extension.
A sample SIP.conf, which includes the SIP trunk 42-A and the SIP users phone1 and phone2, can be found there, as well.

The application is invoked using "node app.js [configurationFilePathAndFileName]"

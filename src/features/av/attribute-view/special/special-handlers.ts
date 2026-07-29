import { Dialog, showMessage, openEmoji } from "siyuan";
import { post } from "../../../../shared/api-client/request";
import { hexToEmoji } from "../../../../shared/utils/av-utils";
import { batchUpdateCellValue } from "./batch-update";

export const BGS = [
    "background:radial-gradient(black 3px, transparent 4px),radial-gradient(black 3px, transparent 4px),linear-gradient(#fff 4px, transparent 0),linear-gradient(45deg, transparent 74px, transparent 75px, #a4a4a4 75px, #a4a4a4 76px, transparent 77px, transparent 109px),linear-gradient(-45deg, transparent 75px, transparent 76px, #a4a4a4 76px, #a4a4a4 77px, transparent 78px, transparent 109px),#fff;background-size: 109px 109px, 109px 109px,100% 6px, 109px 109px, 109px 109px;background-position: 54px 55px, 0px 0px, 0px 0px, 0px 0px, 0px 0px;",
    "background: linear-gradient(45deg, #dca 12%, transparent 0, transparent 88%, #dca 0),linear-gradient(135deg, transparent 37%, #a85 0, #a85 63%, transparent 0),linear-gradient(45deg, transparent 37%, #dca 0, #dca 63%, transparent 0) #753;background-size: 25px 25px;",
    "background: linear-gradient(315deg, transparent 75%, #d45d55 0)-10px 0, linear-gradient(45deg, transparent 75%, #d45d55 0)-10px 0, linear-gradient(135deg, #a7332b 50%, transparent 0) 0 0, linear-gradient(45deg, #6a201b 50%, #561a16 0) 0 0 #561a16;background-size: 20px 20px;",
    "background: linear-gradient(#ffffff 50%, rgba(255,255,255,0) 0) 0 0, radial-gradient(circle closest-side, #FFFFFF 53%, rgba(255,255,255,0) 0) 0 0, radial-gradient(circle closest-side, #FFFFFF 50%, rgba(255,255,255,0) 0) 55px 0 #48B;background-size: 110px 200px;background-repeat: repeat-x;",
    "background:radial-gradient(circle farthest-side at 0% 50%,#fb1 23.5%,rgba(240,166,17,0) 0)21px 30px, radial-gradient(circle farthest-side at 0% 50%,#B71 24%,rgba(240,166,17,0) 0)19px 30px, linear-gradient(#fb1 14%,rgba(240,166,17,0) 0, rgba(240,166,17,0) 85%,#fb1 0)0 0, linear-gradient(150deg,#fb1 24%,#B71 0,#B71 26%,rgba(240,166,17,0) 0,rgba(240,166,17,0) 74%,#B71 0,#B71 76%,#fb1 0)0 0, linear-gradient(30deg,#fb1 24%,#B71 0,#B71 26%,rgba(240,166,17,0) 0,rgba(240,166,17,0) 74%,#B71 0,#B71 76%,#fb1 0)0 0, linear-gradient(90deg,#B71 2%,#fb1 0,#fb1 98%,#B71 0%)0 0 #fb1;background-size: 40px 60px;",
    "background-color: gray;background-image: linear-gradient(transparent 50%, rgba(255,255,255,.5) 50%);background-size: 50px 50px;",
    "background-color: gray;background-image: linear-gradient(90deg, transparent 50%, rgba(255,255,255,.5) 50%);background-size: 50px 50px;",
    "background-color: #026873;background-image: linear-gradient(90deg, rgba(255,255,255,.07) 50%, transparent 50%),linear-gradient(90deg, rgba(255,255,255,.13) 50%, transparent 50%),linear-gradient(90deg, transparent 50%, rgba(255,255,255,.17) 50%),linear-gradient(90deg, transparent 50%, rgba(255,255,255,.19) 50%);background-size: 13px, 29px, 37px, 53px;",
    "background-color: gray;background-image: repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(255,255,255,.5) 35px, rgba(255,255,255,.5) 70px);",
    "background-color:white;background-image: linear-gradient(90deg, rgba(200,0,0,.5) 50%, transparent 50%),linear-gradient(rgba(200,0,0,.5) 50%, transparent 50%);background-size:50px 50px;",
    "background-color:#269;background-image: linear-gradient(white 2px, transparent 2px),linear-gradient(90deg, white 2px, transparent 2px),linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px);background-size: 100px 100px, 100px 100px, 20px 20px, 20px 20px;background-position:-2px -2px, -2px -2px, -1px -1px, -1px -1px;",
    "background-color: #fff;background-image:linear-gradient(90deg, transparent 79px, #abced4 79px, #abced4 81px, transparent 81px),linear-gradient(#eee .1em, transparent .1em);background-size: 100% 1.2em;",
    "background-color: hsl(34, 53%, 82%);background-image: repeating-linear-gradient(45deg, transparent 5px, hsla(197, 62%, 11%, 0.5) 5px, hsla(197, 62%, 11%, 0.5) 10px, hsla(5, 53%, 63%, 0) 10px, hsla(5, 53%, 63%, 0) 35px, hsla(5, 53%, 63%, 0.5) 35px, hsla(5, 53%, 63%, 0.5) 40px, hsla(197, 62%, 11%, 0.5) 40px, hsla(197, 62%, 11%, 0.5) 50px, hsla(197, 62%, 11%, 0) 50px, hsla(197, 62%, 11%, 0) 60px, hsla(5, 53%, 63%, 0.5) 60px, hsla(5, 53%, 63%, 0.5) 70px, hsla(35, 91%, 65%, 0.5) 70px, hsla(35, 91%, 65%, 0.5) 80px, hsla(35, 91%, 65%, 0) 80px, hsla(35, 91%, 65%, 0) 90px, hsla(5, 53%, 63%, 0.5) 90px, hsla(5, 53%, 63%, 0.5) 110px, hsla(5, 53%, 63%, 0) 110px, hsla(5, 53%, 63%, 0) 120px, hsla(197, 62%, 11%, 0.5) 120px, hsla(197, 62%, 11%, 0.5) 140px),repeating-linear-gradient(135deg, transparent 5px, hsla(197, 62%, 11%, 0.5) 5px, hsla(197, 62%, 11%, 0.5) 10px, hsla(5, 53%, 63%, 0) 10px, hsla(5, 53%, 63%, 0) 35px, hsla(5, 53%, 63%, 0.5) 35px, hsla(5, 53%, 63%, 0.5) 40px, hsla(197, 62%, 11%, 0.5) 40px, hsla(197, 62%, 11%, 0.5) 50px, hsla(197, 62%, 11%, 0) 50px, hsla(197, 62%, 11%, 0) 60px, hsla(5, 53%, 63%, 0.5) 60px, hsla(5, 53%, 63%, 0.5) 70px, hsla(35, 91%, 65%, 0.5) 70px, hsla(35, 91%, 65%, 0.5) 80px, hsla(35, 91%, 65%, 0) 80px, hsla(35, 91%, 65%, 0) 90px, hsla(5, 53%, 63%, 0.5) 90px, hsla(5, 53%, 63%, 0.5) 110px, hsla(5, 53%, 63%, 0) 110px, hsla(5, 53%, 63%, 0) 140px, hsla(197, 62%, 11%, 0.5) 140px, hsla(197, 62%, 11%, 0.5) 160px);",
    "background-color: hsl(2, 57%, 40%);background-image: repeating-linear-gradient(transparent, transparent 50px, rgba(0,0,0,.4) 50px, rgba(0,0,0,.4) 53px, transparent 53px, transparent 63px, rgba(0,0,0,.4) 63px, rgba(0,0,0,.4) 66px, transparent 66px, transparent 116px, rgba(0,0,0,.5) 116px, rgba(0,0,0,.5) 166px, rgba(255,255,255,.2) 166px, rgba(255,255,255,.2) 169px, rgba(0,0,0,.5) 169px, rgba(0,0,0,.5) 179px, rgba(255,255,255,.2) 179px, rgba(255,255,255,.2) 182px, rgba(0,0,0,.5) 182px, rgba(0,0,0,.5) 232px, transparent 232px),repeating-linear-gradient(270deg, transparent, transparent 50px, rgba(0,0,0,.4) 50px, rgba(0,0,0,.4) 53px, transparent 53px, transparent 63px, rgba(0,0,0,.4) 63px, rgba(0,0,0,.4) 66px, transparent 66px, transparent 116px, rgba(0,0,0,.5) 116px, rgba(0,0,0,.5) 166px, rgba(255,255,255,.2) 166px, rgba(255,255,255,.2) 169px, rgba(0,0,0,.5) 169px, rgba(0,0,0,.5) 179px, rgba(255,255,255,.2) 179px, rgba(255,255,255,.2) 182px, rgba(0,0,0,.5) 182px, rgba(0,0,0,.5) 232px, transparent 232px),repeating-linear-gradient(125deg, transparent, transparent 2px, rgba(0,0,0,.2) 2px, rgba(0,0,0,.2) 3px, transparent 3px, transparent 5px, rgba(0,0,0,.2) 5px);",
    "background-color: #eee;background-image: linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black),linear-gradient(-45deg, black 25%, transparent 25%, transparent 75%, black 75%, black);background-size: 60px 60px;",
    "background-color: #eee;background-image: linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black),linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black);background-size: 60px 60px;background-position: 0 0, 30px 30px;",
    "background:linear-gradient(-45deg, white 25%, transparent 25%, transparent 75%, black 75%, black) 0 0, linear-gradient(-45deg, black 25%, transparent 25%, transparent 75%, white 75%, white) 1em 1em, linear-gradient(45deg, black 17%, transparent 17%, transparent 25%, black 25%, black 36%, transparent 36%, transparent 64%, black 64%, black 75%, transparent 75%, transparent 83%, black 83%) 1em 1em;background-color: white;background-size: 2em 2em;",
    "background-color:#001;background-image: radial-gradient(white 15%, transparent 16%),radial-gradient(white 15%, transparent 16%);background-size: 60px 60px;background-position: 0 0, 30px 30px;",
    "background-color:#556;background-image: linear-gradient(30deg, #445 12%, transparent 12.5%, transparent 87%, #445 87.5%, #445),linear-gradient(150deg, #445 12%, transparent 12.5%, transparent 87%, #445 87.5%, #445),linear-gradient(30deg, #445 12%, transparent 12.5%, transparent 87%, #445 87.5%, #445),linear-gradient(150deg, #445 12%, transparent 12.5%, transparent 87%, #445 87.5%, #445),linear-gradient(60deg, #99a 25%, transparent 25.5%, transparent 75%, #99a 75%, #99a),linear-gradient(60deg, #99a 25%, transparent 25.5%, transparent 75%, #99a 75%, #99a);background-size:80px 140px;background-position: 0 0, 0 0, 40px 70px, 40px 70px, 0 0, 40px 70px;",
    "background-color:silver;background-image:radial-gradient(circle at 100% 150%, silver 24%, white 24%, white 28%, silver 28%, silver 36%, white 36%, white 40%, transparent 40%, transparent),radial-gradient(circle at 0    150%, silver 24%, white 24%, white 28%, silver 28%, silver 36%, white 36%, white 40%, transparent 40%, transparent),radial-gradient(circle at 50%  100%, white 10%, silver 10%, silver 23%, white 23%, white 30%, silver 30%, silver 43%, white 43%, white 50%, silver 50%, silver 63%, white 63%, white 71%, transparent 71%, transparent),radial-gradient(circle at 100% 50%, white 5%, silver 5%, silver 15%, white 15%, white 20%, silver 20%, silver 29%, white 29%, white 34%, silver 34%, silver 44%, white 44%, white 49%, transparent 49%, transparent),radial-gradient(circle at 0    50%, white 5%, silver 5%, silver 15%, white 15%, white 20%, silver 20%, silver 29%, white 29%, white 34%, silver 34%, silver 44%, white 44%, white 49%, transparent 49%, transparent);background-size: 100px 50px;",
    "background-color: silver;background-image: linear-gradient(335deg, #b00 23px, transparent 23px),linear-gradient(155deg, #d00 23px, transparent 23px),linear-gradient(335deg, #b00 23px, transparent 23px),linear-gradient(155deg, #d00 23px, transparent 23px);background-size: 58px 58px;background-position: 0px 2px, 4px 35px, 29px 31px, 34px 6px;",
    "background-color:#def;background-image: radial-gradient(closest-side, transparent 98%, rgba(0,0,0,.3) 99%),radial-gradient(closest-side, transparent 98%, rgba(0,0,0,.3) 99%);background-size:80px 80px;background-position:0 0, 40px 40px;",
    "background-image:radial-gradient(closest-side, transparent 0%, transparent 75%, #B6CC66 76%, #B6CC66 85%, #EDFFDB 86%, #EDFFDB 94%, #FFFFFF 95%, #FFFFFF 103%, #D9E6A7 104%, #D9E6A7 112%, #798B3C 113%, #798B3C 121%, #FFFFFF 122%, #FFFFFF 130%, #E0EAD7 131%, #E0EAD7 140%),radial-gradient(closest-side, transparent 0%, transparent 75%, #B6CC66 76%, #B6CC66 85%, #EDFFDB 86%, #EDFFDB 94%, #FFFFFF 95%, #FFFFFF 103%, #D9E6A7 104%, #D9E6A7 112%, #798B3C 113%, #798B3C 121%, #FFFFFF 122%, #FFFFFF 130%, #E0EAD7 131%, #E0EAD7 140%);background-size: 110px 110px;background-color: #C8D3A7;background-position: 0 0, 55px 55px;",
    "background:linear-gradient(324deg, #232927 4%,   transparent 4%) -70px 43px, linear-gradient( 36deg, #232927 4%,   transparent 4%) 30px 43px, linear-gradient( 72deg, #e3d7bf 8.5%, transparent 8.5%) 30px 43px, linear-gradient(288deg, #e3d7bf 8.5%, transparent 8.5%) -70px 43px, linear-gradient(216deg, #e3d7bf 7.5%, transparent 7.5%) -70px 23px, linear-gradient(144deg, #e3d7bf 7.5%, transparent 7.5%) 30px 23px, linear-gradient(324deg, #232927 4%,   transparent 4%) -20px 93px, linear-gradient( 36deg, #232927 4%,   transparent 4%) 80px 93px, linear-gradient( 72deg, #e3d7bf 8.5%, transparent 8.5%) 80px 93px, linear-gradient(288deg, #e3d7bf 8.5%, transparent 8.5%) -20px 93px, linear-gradient(216deg, #e3d7bf 7.5%, transparent 7.5%) -20px 73px, linear-gradient(144deg, #e3d7bf 7.5%, transparent 7.5%) 80px 73px;background-color: #232927;background-size: 100px 100px;",
    "background:radial-gradient(circle at 50% 59%, #D2CAAB 3%, #364E27 4%, #364E27 11%, rgba(54,78,39,0) 12%, rgba(54,78,39,0)) 50px 0, radial-gradient(circle at 50% 41%, #364E27 3%, #D2CAAB 4%, #D2CAAB 11%, rgba(210,202,171,0) 12%, rgba(210,202,171,0)) 50px 0, radial-gradient(circle at 50% 59%, #D2CAAB 3%, #364E27 4%, #364E27 11%, rgba(54,78,39,0) 12%, rgba(54,78,39,0)) 0 50px, radial-gradient(circle at 50% 41%, #364E27 3%, #D2CAAB 4%, #D2CAAB 11%, rgba(210,202,171,0) 12%, rgba(210,202,171,0)) 0 50px, radial-gradient(circle at 100% 50%, #D2CAAB 16%, rgba(210,202,171,0) 17%),radial-gradient(circle at 0% 50%, #364E27 16%, rgba(54,78,39,0) 17%),radial-gradient(circle at 100% 50%, #D2CAAB 16%, rgba(210,202,171,0) 17%) 50px 50px, radial-gradient(circle at 0% 50%, #364E27 16%, rgba(54,78,39,0) 17%) 50px 50px;background-color:#63773F;background-size:100px 100px;",
    "background:radial-gradient(circle, transparent 20%, slategray 20%, slategray 80%, transparent 80%, transparent),radial-gradient(circle, transparent 20%, slategray 20%, slategray 80%, transparent 80%, transparent) 50px 50px, linear-gradient(#A8B1BB 8px, transparent 8px) 0 -4px, linear-gradient(90deg, #A8B1BB 8px, transparent 8px) -4px 0;background-color: slategray;background-size:100px 100px, 100px 100px, 50px 50px, 50px 50px;",
    "background:radial-gradient(circle at 100% 50%, transparent 20%, rgba(255,255,255,.3) 21%, rgba(255,255,255,.3) 34%, transparent 35%, transparent),radial-gradient(circle at 0% 50%, transparent 20%, rgba(255,255,255,.3) 21%, rgba(255,255,255,.3) 34%, transparent 35%, transparent) 0 -50px;background-color: slategray;background-size:75px 100px;",
    "background-color: #FF7D9D;background-size: 58px 58px;background-position: 0px 2px, 4px 35px, 29px 31px, 33px 6px, 0px 36px, 4px 2px, 29px 6px, 33px 30px;background-image:linear-gradient(335deg, #C90032 23px, transparent 23px),linear-gradient(155deg, #C90032 23px, transparent 23px),linear-gradient(335deg, #C90032 23px, transparent 23px),linear-gradient(155deg, #C90032 23px, transparent 23px),linear-gradient(335deg, #C90032 10px, transparent 10px),linear-gradient(155deg, #C90032 10px, transparent 10px),linear-gradient(335deg, #C90032 10px, transparent 10px),linear-gradient(155deg, #C90032 10px, transparent 10px);",
    "background-color: #6d695c;background-image:repeating-linear-gradient(120deg, rgba(255,255,255,.1), rgba(255,255,255,.1) 1px, transparent 1px, transparent 60px),repeating-linear-gradient(60deg, rgba(255,255,255,.1), rgba(255,255,255,.1) 1px, transparent 1px, transparent 60px),linear-gradient(60deg, rgba(0,0,0,.1) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.1) 75%, rgba(0,0,0,.1)),linear-gradient(120deg, rgba(0,0,0,.1) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.1) 75%, rgba(0,0,0,.1));background-size: 70px 120px;",
    "background:radial-gradient(circle closest-side at 60% 43%, #b03 26%, rgba(187,0,51,0) 27%),radial-gradient(circle closest-side at 40% 43%, #b03 26%, rgba(187,0,51,0) 27%),radial-gradient(circle closest-side at 40% 22%, #d35 45%, rgba(221,51,85,0) 46%),radial-gradient(circle closest-side at 60% 22%, #d35 45%, rgba(221,51,85,0) 46%),radial-gradient(circle closest-side at 50% 35%, #d35 30%, rgba(221,51,85,0) 31%),radial-gradient(circle closest-side at 60% 43%, #b03 26%, rgba(187,0,51,0) 27%) 50px 50px, radial-gradient(circle closest-side at 40% 43%, #b03 26%, rgba(187,0,51,0) 27%) 50px 50px, radial-gradient(circle closest-side at 40% 22%, #d35 45%, rgba(221,51,85,0) 46%) 50px 50px, radial-gradient(circle closest-side at 60% 22%, #d35 45%, rgba(221,51,85,0) 46%) 50px 50px, radial-gradient(circle closest-side at 50% 35%, #d35 30%, rgba(221,51,85,0) 31%) 50px 50px;background-color:#b03;background-size:100px 100px;",
    "background:radial-gradient(black 15%, transparent 16%) 0 0, radial-gradient(black 15%, transparent 16%) 8px 8px, radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 0 1px, radial-gradient(rgba(255,255,255,.1) 15%, transparent 20%) 8px 9px;background-color:#282828;background-size:16px 16px;",
    "background:linear-gradient(27deg, #151515 5px, transparent 5px) 0 5px, linear-gradient(207deg, #151515 5px, transparent 5px) 10px 0px, linear-gradient(27deg, #222 5px, transparent 5px) 0px 10px, linear-gradient(207deg, #222 5px, transparent 5px) 10px 5px, linear-gradient(90deg, #1b1b1b 10px, transparent 10px),linear-gradient(#1d1d1d 25%, #1a1a1a 25%, #1a1a1a 50%, transparent 50%, transparent 75%, #242424 75%, #242424);background-color: #131313;background-size: 20px 20px;",
    "background:radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.15) 30%, rgba(255,255,255,.3) 32%, rgba(255,255,255,0) 33%) 0 0, radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.1) 11%, rgba(255,255,255,.3) 13%, rgba(255,255,255,0) 14%) 0 0, radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.2) 17%, rgba(255,255,255,.43) 19%, rgba(255,255,255,0) 20%) 0 110px, radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.2) 11%, rgba(255,255,255,.4) 13%, rgba(255,255,255,0) 14%) -130px -170px, radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.2) 11%, rgba(255,255,255,.4) 13%, rgba(255,255,255,0) 14%) 130px 370px, radial-gradient(rgba(255,255,255,0) 0, rgba(255,255,255,.1) 11%, rgba(255,255,255,.2) 13%, rgba(255,255,255,0) 14%) 0 0, linear-gradient(45deg, #343702 0%, #184500 20%, #187546 30%, #006782 40%, #0b1284 50%, #760ea1 60%, #83096e 70%, #840b2a 80%, #b13e12 90%, #e27412 100%);background-size: 470px 470px, 970px 970px, 410px 410px, 610px 610px, 530px 530px, 730px 730px, 100% 100%;background-color: #840b2a;",
    "background-color:white;background-image:radial-gradient(midnightblue 9px, transparent 10px),repeating-radial-gradient(midnightblue 0, midnightblue 4px, transparent 5px, transparent 20px, midnightblue 21px, midnightblue 25px, transparent 26px, transparent 50px);background-size: 30px 30px, 90px 90px;background-position: 0 0;",
    "background-color:black;background-image:radial-gradient(white, rgba(255,255,255,.2) 2px, transparent 40px),radial-gradient(white, rgba(255,255,255,.15) 1px, transparent 30px),radial-gradient(white, rgba(255,255,255,.1) 2px, transparent 40px),radial-gradient(rgba(255,255,255,.4), rgba(255,255,255,.1) 2px, transparent 30px);background-size: 550px 550px, 350px 350px, 250px 250px, 150px 150px;background-position: 0 0, 40px 60px, 130px 270px, 70px 100px;",
    "background:radial-gradient(hsl(0, 100%, 27%) 4%, hsl(0, 100%, 18%) 9%, hsla(0, 100%, 20%, 0) 9%) 0 0, radial-gradient(hsl(0, 100%, 27%) 4%, hsl(0, 100%, 18%) 8%, hsla(0, 100%, 20%, 0) 10%) 50px 50px, radial-gradient(hsla(0, 100%, 30%, 0.8) 20%, hsla(0, 100%, 20%, 0)) 50px 0, radial-gradient(hsla(0, 100%, 30%, 0.8) 20%, hsla(0, 100%, 20%, 0)) 0 50px, radial-gradient(hsla(0, 100%, 20%, 1) 35%, hsla(0, 100%, 20%, 0) 60%) 50px 0, radial-gradient(hsla(0, 100%, 20%, 1) 35%, hsla(0, 100%, 20%, 0) 60%) 100px 50px, radial-gradient(hsla(0, 100%, 15%, 0.7), hsla(0, 100%, 20%, 0)) 0 0, radial-gradient(hsla(0, 100%, 15%, 0.7), hsla(0, 100%, 20%, 0)) 50px 50px, linear-gradient(45deg, hsla(0, 100%, 20%, 0) 49%, hsla(0, 100%, 0%, 1) 50%, hsla(0, 100%, 20%, 0) 70%) 0 0, linear-gradient(-45deg, hsla(0, 100%, 20%, 0) 49%, hsla(0, 100%, 0%, 1) 50%, hsla(0, 100%, 20%, 0) 70%) 0 0;background-color: #300;background-size: 100px 100px;",
    "background:linear-gradient(135deg, #708090 21px, #d9ecff 22px, #d9ecff 24px, transparent 24px, transparent 67px, #d9ecff 67px, #d9ecff 69px, transparent 69px),linear-gradient(225deg, #708090 21px, #d9ecff 22px, #d9ecff 24px, transparent 24px, transparent 67px, #d9ecff 67px, #d9ecff 69px, transparent 69px)0 64px;background-color:#708090;background-size: 64px 128px;",
    "background:linear-gradient(135deg, #ECEDDC 25%, transparent 25%) -50px 0, linear-gradient(225deg, #ECEDDC 25%, transparent 25%) -50px 0, linear-gradient(315deg, #ECEDDC 25%, transparent 25%),linear-gradient(45deg, #ECEDDC 25%, transparent 25%);background-size: 100px 100px;background-color: #EC173A;",
    "background:linear-gradient(45deg, #92baac 45px, transparent 45px)64px 64px, linear-gradient(45deg, #92baac 45px, transparent 45px,transparent 91px, #e1ebbd 91px, #e1ebbd 135px, transparent 135px),linear-gradient(-45deg, #92baac 23px, transparent 23px, transparent 68px,#92baac 68px,#92baac 113px,transparent 113px,transparent 158px,#92baac 158px);background-color:#e1ebbd;background-size: 128px 128px;",
    "background:linear-gradient(63deg, #999 23%, transparent 23%) 7px 0,linear-gradient(63deg, transparent 74%, #999 78%),linear-gradient(63deg, transparent 34%, #999 38%, #999 58%, transparent 62%),#444;background-size: 16px 48px;",
    "background:#36c;background:linear-gradient(115deg, transparent 75%, rgba(255,255,255,.8) 75%) 0 0,linear-gradient(245deg, transparent 75%, rgba(255,255,255,.8) 75%) 0 0,linear-gradient(115deg, transparent 75%, rgba(255,255,255,.8) 75%) 7px -15px,linear-gradient(245deg, transparent 75%, rgba(255,255,255,.8) 75%) 7px -15px,#36c;background-size: 15px 30px;",
    "background:radial-gradient(circle at 0% 50%, rgba(96, 16, 48, 0) 9px, #613 10px, rgba(96, 16, 48, 0) 11px) 0px 10px,radial-gradient(at 100% 100%,rgba(96, 16, 48, 0) 9px, #613 10px, rgba(96, 16, 48, 0) 11px),#8a3;background-size: 20px 20px;",
    "background-image:linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
    "background-image:linear-gradient(to top, #fbc2eb 0%, #a6c1ee 100%)",
    "background-image:linear-gradient(120deg, #a6c0fe 0%, #f68084 100%)",
    "background-image:linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)",
    "background-image:linear-gradient(to right, #fa709a 0%, #fee140 100%)",
    "background-image:linear-gradient(to top, #30cfd0 0%, #330867 100%)",
    "background-image:linear-gradient(to top, #a8edea 0%, #fed6e3 100%)",
    "background-image:linear-gradient(to top, #d299c2 0%, #fef9d7 100%)",
    "background-image:linear-gradient(to top, #fddb92 0%, #d1fdff 100%)",
    "background-image:linear-gradient(to top, #9890e3 0%, #b1f4cf 100%)",
    "background-image:linear-gradient(to top, #96fbc4 0%, #f9f586 100%)",
    "background-image:linear-gradient(to right, #eea2a2 0%, #bbc1bf 19%, #57c6e1 42%, #b49fda 79%, #7ac5d8 100%)",
    "background-image:linear-gradient(to top, #9795f0 0%, #fbc8d4 100%)",
    "background-image:linear-gradient(to top, #3f51b1 0%, #5a55ae 13%, #7b5fac 25%, #8f6aae 38%, #a86aa4 50%, #cc6b8e 62%, #f18271 75%, #f3a469 87%, #f7c978 100%)",
    "background-image:linear-gradient(to top, #f43b47 0%, #453a94 100%)",
    "background-image:linear-gradient(to top, #88d3ce 0%, #6e45e2 100%)",
    "background-image:linear-gradient(to top, #d9afd9 0%, #97d9e1 100%)",
    "background-image:linear-gradient(-20deg, #b721ff 0%, #21d4fd 100%)",
    "background-image:linear-gradient(60deg, #abecd6 0%, #fbed96 100%)",
    "background-image:linear-gradient(to top, #3b41c5 0%, #a981bb 49%, #ffc8a9 100%)",
    "background-image:linear-gradient(to top, #0fd850 0%, #f9f047 100%)",
    "background-image:linear-gradient(to top, #d5dee7 0%, #ffafbd 0%, #c9ffbf 100%)",
    "background-image:linear-gradient(to top, #65bd60 0%, #5ac1a8 25%, #3ec6ed 50%, #b7ddb7 75%, #fef381 100%)",
    "background-image:linear-gradient(to top, #50cc7f 0%, #f5d100 100%)",
    "background-image:linear-gradient(to top, #df89b5 0%, #bfd9fe 100%)",
    "background-image:linear-gradient(to top, #e14fad 0%, #f9d423 100%)",
    "background-image:linear-gradient(to right, #ec77ab 0%, #7873f5 100%)",
    "background-image:linear-gradient(-225deg, #2CD8D5 0%, #C5C1FF 56%, #FFBAC3 100%)",
    "background-image:linear-gradient(-225deg, #5271C4 0%, #B19FFF 48%, #ECA1FE 100%)",
    "background-image:linear-gradient(-225deg, #FF3CAC 0%, #562B7C 52%, #2B86C5 100%)",
    "background-image:linear-gradient(-225deg, #69EACB 0%, #EACCF8 48%, #6654F1 100%)",
    "background-image:linear-gradient(-225deg, #231557 0%, #44107A 29%, #FF1361 67%, #FFF800 100%)"
];

function renderPreview(id: string, path: string, previewEl: HTMLElement) {
    previewEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
    post("/api/template/render", { id, path }).then((renderRes: any) => {
        if (renderRes && renderRes.content) {
            previewEl.innerHTML = `<div class="protyle-wysiwyg" style="padding:0; background:transparent;">${renderRes.content}</div>`;
        } else {
            previewEl.innerHTML = '<div class="ft__center ft__on-surface">模板内容为空</div>';
        }
    }).catch(err => {
        previewEl.innerHTML = `<div class="ft__center ft__error" style="padding: 20px;">渲染失败: ${err.message}</div>`;
    });
}

function renderPreviewAsset(path: string, previewEl: HTMLElement) {
    previewEl.innerHTML = `<img src="/${path}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; box-shadow: var(--b3-dialog-shadow);">`;
}

/**
 * 核心更新逻辑：更新单个单元格
 */
export async function updateCellValue(protyleInstance: any, avID: string, rowID: string, colID: string, newValue: string) {
    try {
        const avData = await post("/api/av/renderAttributeView", { id: avID, pageSize: 1000 });
        const view = avData.view || avData;
        const rows = view.rows || [];
        const row = rows.find((r: any) => r.id === rowID);
        const columns = view.columns || [];
        const cellIndex = columns.findIndex((c: any) => c.id === colID);

        if (!row || cellIndex === -1) throw new Error("Row or Column not found in current view");

        const cellData = row.cells[cellIndex];
        const cellValue = cellData.value || {};
        const cellType = cellValue.type || cellData.valueType || "text";
        const updateData: any = { id: cellData.id, type: cellType };

        if (["text", "template", "url", "email", "phone"].includes(cellType)) {
            updateData[cellType] = { content: newValue };
        } else if (cellType === "mAsset") {
            updateData.mAsset = [{ content: newValue, name: newValue.split('/').pop() }];
        } else {
            updateData.type = "text";
            updateData.text = { content: newValue };
        }

        const operation = {
            action: "updateAttrViewCell",
            id: cellData.id, avID: avID, keyID: colID, rowID: rowID, data: updateData
        };

        if (protyleInstance) {
            protyleInstance.transaction([operation]);
        } else {
            await post("/api/transactions", {
                app: "plugin-index",
                reqId: Date.now(),
                transactions: [{ doOperations: [operation] }]
            });
        }
        showMessage(`✅ 已保存: ${newValue.substring(0, 20)}${newValue.length > 20 ? '...' : ''}`, 3000);
    } catch (e: any) {
        console.error("Update Value Error", e);
        showMessage(`❌ 保存失败: ${e.message}`, 3000, "error");
    }
}

export function openEmojiDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "", event?: MouseEvent) {
    if (typeof openEmoji === 'function') {
        const x = event?.clientX || window.innerWidth / 2 - 150;
        const y = event?.clientY || window.innerHeight / 2 - 200;

        openEmoji({
            position: { x, y },
            hideDynamicIcon: true,
            hideCustomIcon: true,
            selectedCB: (emoji: string) => {
                if (emoji !== undefined) {
                    const decodedEmoji = hexToEmoji(emoji);
                    if (isBatch) {
                        batchUpdateCellValue(protyleInstance, avID, colID, decodedEmoji, "text", avBlockID);
                    } else {
                        updateCellValue(protyleInstance, avID, rowID, colID, decodedEmoji);
                    }
                }
            }
        });
    } else {
        console.warn("[AttributeView-Emoji] SiYuan version does not support openEmoji API. Please update SiYuan.");
    }
}

export function openBuiltInImagesDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "") {
    let html = "";
    BGS.forEach((item, index) => {
        html += `<div data-index="${index}" style="height: 128px;${item}; cursor: pointer; border-radius: 4px; border: 1px solid var(--indexos-border-light);" class="b3-card b3-card--wrap av-card"></div>`;
    });

    const dialog = new Dialog({
        title: "选择内置背景",
        content: `<div class="built-in-bgs" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; padding: 16px; overflow-y: auto; max-height: 70vh;">${html}</div>`,
        width: "900px",
    });
    dialog.element.classList.add("indexos-dialog");

    dialog.element.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("b3-card")) {
            const index = parseInt(target.getAttribute("data-index")!);
            const bgStyle = BGS[index];
            if (isBatch) {
                batchUpdateCellValue(protyleInstance, avID, colID, bgStyle, "text", avBlockID);
            } else {
                updateCellValue(protyleInstance, avID, rowID, colID, bgStyle);
            }
            dialog.destroy();
        }
    });
}

export function openAssetDialog(protyleInstance: any, avID: string, rowID: string, colID: string, isBatch = false, avBlockID = "") {
    const dialog = new Dialog({
        title: "选择资源",
        content: `
        <div id="sync-plugin-asset-root" style="display:flex; height: 60vh; width: 100%; box-sizing: border-box; overflow: hidden; border-radius: 0 0 4px 4px; background-color: var(--indexos-bg-base);">
            <div class="asset-sidebar" style="width: 320px; border-right: 1px solid var(--indexos-border-light); display: flex; flex-direction: column; background-color: var(--indexos-bg-surface);">
                <div style="padding: 8px;">
                    <input class="b3-text-field fn__block" placeholder="搜索资源 (↑↓导航 Enter选择)" id="asset-search-input" autofocus style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background-color: var(--indexos-bg-container); color: var(--indexos-text-main); border: 1px solid var(--indexos-border-light);">
                </div>
                <div class="b3-list b3-list--background fn__flex-1" id="asset-list" style="overflow-y: auto;">
                    <div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>
                </div>
            </div>
            <div id="asset-preview" class="fn__flex-1" style="padding: 16px; display: flex; align-items: center; justify-content: center; background-color: var(--indexos-bg-base); color: var(--indexos-text-main); overflow: hidden;">
                <div class="ft__center" style="color: var(--indexos-text-muted);">请选择资源预览</div>
            </div>
        </div>`,
        width: "900px",
    });
    dialog.element.classList.add("indexos-dialog");

    const listEl = dialog.element.querySelector("#asset-list") as HTMLElement;
    const previewEl = dialog.element.querySelector("#asset-preview") as HTMLElement;
    const inputEl = dialog.element.querySelector("#asset-search-input") as HTMLInputElement;
    let currentPreviewPath = "";
    let hoverTimer: any = null;

    const renderList = (keyword = "") => {
        listEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
        post("/api/search/searchAsset", {
            k: keyword,
            exts: [".png", ".jpg", ".jpeg", ".gif", ".webp"]
        }).then((res: any) => {
            let html = "";
            const assets = res || [];
            if (assets.length > 0) {
                assets.forEach((item: any, index: number) => {
                    const isFocus = index === 0 ? " b3-list-item--focus" : "";
                    html += `<div class="b3-list-item b3-list-item--hide-action${isFocus}" 
                        data-path="${item.path}" 
                        style="cursor: pointer; padding: 6px 10px; margin: 2px 4px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                        <span class="b3-list-item__text" style="color: var(--indexos-text-main);">${item.hName}</span>
                    </div>`;
                });
            } else {
                html = `<div class="b3-list--empty" style="padding: 16px; text-align: center; color: var(--indexos-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">无匹配资源</div>`;
            }
            listEl.innerHTML = html;

            const firstItem = listEl.querySelector(".b3-list-item") as HTMLElement;
            if (firstItem) {
                const path = firstItem.getAttribute("data-path")!;
                currentPreviewPath = path;
                renderPreviewAsset(path, previewEl);
            }

            listEl.querySelectorAll(".b3-list-item").forEach(item => {
                const path = item.getAttribute("data-path")!;
                item.addEventListener("mouseenter", () => {
                    if (currentPreviewPath === path) return;
                    listEl.querySelectorAll(".b3-list-item--focus").forEach(i => i.classList.remove("b3-list-item--focus"));
                    item.classList.add("b3-list-item--focus");
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(() => {
                        currentPreviewPath = path;
                        renderPreviewAsset(path, previewEl);
                    }, 150);
                });

                item.addEventListener("click", () => {
                    const finalVal = `background-image:url("${path}")`;
                    if (isBatch) {
                        batchUpdateCellValue(protyleInstance, avID, colID, finalVal, "text", avBlockID);
                    } else {
                        updateCellValue(protyleInstance, avID, rowID, colID, finalVal);
                    }
                    dialog.destroy();
                });
            });
        }).catch(err => {
            listEl.innerHTML = `<div class="ft__center ft__error" style="padding: 16px;">查询失败: ${err.message}</div>`;
        });
    };

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        const currentFocus = listEl.querySelector(".b3-list-item--focus") as HTMLElement;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = currentFocus ? currentFocus.nextElementSibling : listEl.querySelector(".b3-list-item");
            if (next && next.classList.contains("b3-list-item")) {
                next.dispatchEvent(new MouseEvent("mouseenter"));
                next.scrollIntoView({ block: "nearest" });
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const prev = currentFocus ? currentFocus.previousElementSibling : listEl.querySelector(".b3-list-item:last-child");
            if (prev && prev.classList.contains("b3-list-item")) {
                prev.dispatchEvent(new MouseEvent("mouseenter"));
                prev.scrollIntoView({ block: "nearest" });
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (currentFocus) currentFocus.click();
        }
    });

    renderList();
    inputEl.addEventListener("input", (e: any) => renderList(e.target.value));
    setTimeout(() => inputEl.focus(), 100);
}

export function openTemplateDialog(protyleInstance: any, avID: string, rowID: string, colID: string, avBlockID: string, isBatch = false) {
    // @ts-ignore
    const renderID = protyleInstance ? protyleInstance.protyle.block.rootID : (avBlockID || "");
    const dialog = new Dialog({
        title: "选择模板",
        content: `
        <div id="sync-plugin-template-root" style="display:flex; height: 60vh; width: 100%; box-sizing: border-box; overflow: hidden; border-radius: 0 0 4px 4px; background-color: var(--indexos-bg-base);">
            <div class="template-sidebar" style="width: 280px; border-right: 1px solid var(--indexos-border-light); display: flex; flex-direction: column; background-color: var(--indexos-bg-surface);">
                <div style="padding: 8px;">
                    <input class="b3-text-field fn__block" placeholder="搜索模板 (↑↓导航 Enter选择)" id="template-search-input" autofocus style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background-color: var(--indexos-bg-container); color: var(--indexos-text-main); border: 1px solid var(--indexos-border-light);">
                </div>
                <div class="b3-list b3-list--background fn__flex-1" id="template-list" style="overflow-y: auto;">
                    <div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>
                </div>
            </div>
            <div id="template-preview" class="fn__flex-1" style="padding: 16px; overflow-y: auto; background-color: var(--indexos-bg-base); color: var(--indexos-text-main);">
                <div class="ft__center" style="color: var(--indexos-text-muted); margin-top: 20vh;">请选择模板预览</div>
            </div>
        </div>`,
        width: "900px",
    });
    dialog.element.classList.add("indexos-dialog");

    const listEl = dialog.element.querySelector("#template-list") as HTMLElement;
    const previewEl = dialog.element.querySelector("#template-preview") as HTMLElement;
    const inputEl = dialog.element.querySelector("#template-search-input") as HTMLInputElement;
    let currentPreviewPath = "";
    let hoverTimer: any = null;

    const renderList = (keyword = "") => {
        listEl.innerHTML = '<div class="fn__loading" style="padding: 20px;"><img width="32px" src="/stage/loading-pure.svg"></div>';
        post("/api/search/searchTemplate", { k: keyword }).then((res: any) => {
            let html = "";
            const templates = res.templates || [];
            if (templates.length > 0) {
                templates.forEach((item: any, index: number) => {
                    const isFocus = index === 0 ? " b3-list-item--focus" : "";
                    html += `<div class="b3-list-item b3-list-item--hide-action${isFocus}" 
                        data-path="${item.path}" 
                        data-content="${item.content.replace(/"/g, '&quot;')}"
                        style="cursor: pointer; padding: 6px 10px; margin: 2px 4px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                        <span class="b3-list-item__text" style="color: var(--indexos-text-main);">${item.content}</span>
                    </div>`;
                });
            } else {
                html = `<div class="b3-list--empty" style="padding: 16px; text-align: center; color: var(--indexos-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">无匹配模板</div>`;
            }
            listEl.innerHTML = html;

            const firstItem = listEl.querySelector(".b3-list-item") as HTMLElement;
            if (firstItem) {
                const path = firstItem.getAttribute("data-path")!;
                currentPreviewPath = path;
                renderPreview(renderID, path, previewEl);
            }

            listEl.querySelectorAll(".b3-list-item").forEach(item => {
                const path = item.getAttribute("data-path")!;
                const content = item.getAttribute("data-content")!;
                item.addEventListener("mouseenter", () => {
                    if (currentPreviewPath === path) return;
                    listEl.querySelectorAll(".b3-list-item--focus").forEach(i => i.classList.remove("b3-list-item--focus"));
                    item.classList.add("b3-list-item--focus");
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(() => {
                        currentPreviewPath = path;
                        renderPreview(renderID, path, previewEl);
                    }, 150);
                });

                item.addEventListener("click", () => {
                    if (isBatch) {
                        batchUpdateCellValue(protyleInstance, avID, colID, content, "text", avBlockID);
                    } else {
                        updateCellValue(protyleInstance, avID, rowID, colID, content);
                    }
                    dialog.destroy();
                });
            });
        }).catch(err => {
            listEl.innerHTML = `<div class="ft__center ft__error" style="padding: 16px;">查询失败: ${err.message}</div>`;
        });
    };

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        const currentFocus = listEl.querySelector(".b3-list-item--focus") as HTMLElement;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = currentFocus ? currentFocus.nextElementSibling : listEl.querySelector(".b3-list-item");
            if (next && next.classList.contains("b3-list-item")) {
                next.dispatchEvent(new MouseEvent("mouseenter"));
                next.scrollIntoView({ block: "nearest" });
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const prev = currentFocus ? currentFocus.previousElementSibling : listEl.querySelector(".b3-list-item:last-child");
            if (prev && prev.classList.contains("b3-list-item")) {
                prev.dispatchEvent(new MouseEvent("mouseenter"));
                prev.scrollIntoView({ block: "nearest" });
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (currentFocus) currentFocus.click();
        }
    });

    renderList();
    inputEl.addEventListener("input", (e: any) => renderList(e.target.value));
    setTimeout(() => inputEl.focus(), 100);
}
